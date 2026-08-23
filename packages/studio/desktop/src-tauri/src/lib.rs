/**
 * MorPex Studio 桌面壳（Tauri 2）。
 *
 * 职责（薄壳：开窗加载渲染层 + 管理后端生命周期）：
 *   1. 启动时探测 localhost:5473，未运行则自动拉起后端（二选一）：
 *      - 安装包模式：从资源目录启动打包的运行时（esbuild 单文件，方案 A）
 *        <resource>/runtime/node.exe  <解压目录>/server.mjs  (cwd=<解压目录>，即 server.mjs 同级)
 *        兼容旧版运行时布局（repo.zip 内为 tsx + 源码树）：自动探测回退
 *      - 开发模式（无内置运行时）：从仓库启动 node tsx packages/studio/server/index.ts
 *        （仓库探测 MORPEX_REPO / 向上找标记仅服务于此开发回退路径）
 *   2. 用户 API Key 配置：%APPDATA%/<identifier>/config.env（首次运行自动生成模板），
 *      解析后作为环境变量注入后端（后端 morpex.yaml 用 ${VAR} 引用）。
 *   3. 退出时杀掉由本壳拉起的后端（手动已跑的不杀）。
 *
 * 解耦红线：本壳不 import 任何 @morpex 包或 server 代码；spawn 只是通用子进程命令。
 */
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

const BACKEND_PORT: u16 = 5473;
/// 安装包资源（bundle.resources: node.exe / repo.zip → runtime/）
const RES_NODE: &str = "runtime/node.exe";
const RES_ZIP: &str = "runtime/repo.zip";
/// 新版单文件运行时入口（repo.zip 解压后的根，方案 A esbuild 产物）
const RUNTIME_ENTRY_MJS: &str = "server.mjs";
/// 首启解压目录：%LOCALAPPDATA%/MorPex/runtime（repo.zip 解压到此 = 后端仓库根）
const RUNTIME_MARKER: &str = ".morpex-version";
/// 用户配置文件（%APPDATA%/MorPex/config.env）
const USER_ENV_FILE: &str = "config.env";

/// 由壳拉起、需在退出时清理的后端子进程。
struct BackendHandle(Mutex<Option<Child>>);

/// 探测后端是否已在运行（TCP 连接 127.0.0.1:5473）。
fn backend_up(port: u16) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap_or_else(|_| {
        (std::net::Ipv4Addr::LOCALHOST, port).into()
    });
    TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
}

fn is_repo_root(dir: &Path) -> bool {
    dir.join("packages/studio/server/index.ts").is_file()
}

/// 开发模式定位仓库根：MORPEX_REPO 环境变量优先，否则从 exe 位置向上找。
fn find_repo_root() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("MORPEX_REPO") {
        let b = PathBuf::from(p);
        if is_repo_root(&b) {
            return Some(b);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?;
    for _ in 0..8 {
        if is_repo_root(dir) {
            return Some(dir.to_path_buf());
        }
        dir = dir.parent()?;
    }
    None
}

/// 安装包资源是否包含可移植运行时（node.exe + repo.zip）。
fn has_bundled_runtime(res: &Path) -> bool {
    res.join(RES_NODE).is_file() && res.join(RES_ZIP).is_file()
}

/// 运行时目录：%LOCALAPPDATA%/MorPex/runtime
fn runtime_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("MorPex")
        .join("runtime")
}

/// 首启把 repo.zip 解压到运行时目录（按版本号标记，版本变化则重新解压）。
/// 解压成功判定兼容两种布局：新版单文件（server.mjs）/ 旧版 tsx+源码树。失败返回 None。
fn ensure_runtime_extracted(res: &Path, version: &str) -> Option<PathBuf> {
    let dir = runtime_dir();
    let zip = res.join(RES_ZIP);
    if !zip.is_file() {
        return None;
    }
    let marker = dir.join(RUNTIME_MARKER);
    let up_to_date = marker.is_file()
        && std::fs::read_to_string(&marker).ok().as_deref() == Some(version);
    if !up_to_date {
        println!("[desktop] 解压内置后端运行时 v{version} 到 {}", dir.display());
        let _ = std::fs::create_dir_all(&dir);
        // bsdtar 支持长路径（Node 依赖含 >260 字符深层路径，PowerShell 会失败）。
        // ⚠️ 以「关键文件是否解压成功」为准，不依赖 tar 退出码（长路径警告可能致非 0 退出）。
        let _ = Command::new("tar")
            .arg("-xf")
            .arg(&zip)
            .arg("-C")
            .arg(&dir)
            .status();
        let extracted_ok = dir.join(RUNTIME_ENTRY_MJS).is_file()
            || (dir.join("node_modules/tsx/dist/cli.mjs").is_file()
                && dir.join("packages/studio/server/index.ts").is_file());
        if extracted_ok {
            let _ = std::fs::write(&marker, version);
        } else {
            println!("[desktop] ⚠️ 后端运行时解压失败（缺少关键文件）");
            return None;
        }
    }
    Some(dir)
}

/// 运行时布局（决定拉起命令形态）。
enum RuntimeLayout {
    /// 方案 A：esbuild 单文件。启动 `node server.mjs`，cwd=runtime 目录
    /// （require('better-sqlite3') 解析到同级 node_modules，config/ 相对可寻址）。
    SingleFile,
    /// 旧版：tsx + 源码树（兼容已按版本缓存、未重新解压的老用户）。
    LegacyTsx { tsx: PathBuf, entry: PathBuf },
}

fn detect_runtime_layout(dir: &Path) -> Option<RuntimeLayout> {
    if dir.join(RUNTIME_ENTRY_MJS).is_file() {
        return Some(RuntimeLayout::SingleFile);
    }
    let tsx = dir.join("node_modules/tsx/dist/cli.mjs");
    let entry = dir.join("packages/studio/server/index.ts");
    (tsx.is_file() && entry.is_file()).then_some(RuntimeLayout::LegacyTsx { tsx, entry })
}

/// 用户 API Key 配置：首次运行生成模板，读取 KEY=VALUE 行。
/// 位置：%APPDATA%/MorPex/config.env（用户可编辑，重启生效）。
fn ensure_user_env() -> Vec<(String, String)> {
    let dir = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("MorPex");
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join(USER_ENV_FILE);
    if !file.is_file() {
        let template = "# MorPex 用户配置（API Key 等环境变量）\n\
                        # 每行一个 KEY=VALUE，保存后重启应用生效\n\
                        # AGNES_API_KEY=your_key_here\n\
                        # SILICONFLOW_API_KEY=your_key_here\n\
                        # MINICPM_API_KEY=your_key_here\n";
        let _ = std::fs::write(&file, template);
    }
    let mut out = Vec::new();
    if let Ok(content) = std::fs::read_to_string(&file) {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                let k = k.trim();
                let v = v.trim();
                if !k.is_empty() && !v.is_empty() {
                    out.push((k.to_string(), v.to_string()));
                }
            }
        }
    }
    if !out.is_empty() {
        println!("[desktop] 已从 {} 读取 {} 个用户环境变量", file.display(), out.len());
    }
    out
}

/// spawn 后端子进程（args 为完整命令参数；cwd 见参数，日志追加 cwd/logs/desktop-backend.log）。
fn spawn_backend(
    node: &str,
    args: &[String],
    cwd: &Path,
    user_env: &[(String, String)],
) -> std::io::Result<Child> {
    let log_dir = cwd.join("logs");
    std::fs::create_dir_all(&log_dir)?;
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("desktop-backend.log"))?;
    let err = log.try_clone()?;
    let mut cmd = Command::new(node);
    cmd.args(args)
        .current_dir(cwd)
        .env("PORT", BACKEND_PORT.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err));
    for (k, v) in user_env {
        cmd.env(k, v);
    }
    // ⚠️ 父进程是 GUI（无控制台）。不加此标志时 Windows 会给 node 新建黑窗口。CREATE_NO_WINDOW 抑制。
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
}

/// 结束后端进程（Windows 用 taskkill /T 杀整棵进程树）。
fn kill_backend(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if backend_up(BACKEND_PORT) {
                println!("[desktop] 后端已在运行 (localhost:{BACKEND_PORT})，跳过自动启动");
                return Ok(());
            }

            let user_env = ensure_user_env();
            let version = app.package_info().version.to_string();

            // 优先安装包内置运行时（解压后启动）；否则回退开发模式（仓库）
            let res = app.path().resource_dir().ok();
            let spawned = if let Some(res_dir) = res.as_ref() {
                if has_bundled_runtime(res_dir) {
                    match ensure_runtime_extracted(res_dir, &version).and_then(|rt| {
                        detect_runtime_layout(&rt).map(|layout| (rt, layout))
                    }) {
                        Some((runtime, layout)) => {
                            let node = res_dir.join(RES_NODE);
                            let args: Vec<String> = match layout {
                                RuntimeLayout::SingleFile => {
                                    vec![runtime.join(RUNTIME_ENTRY_MJS).to_string_lossy().into_owned()]
                                }
                                RuntimeLayout::LegacyTsx { tsx, entry } => vec![
                                    tsx.to_string_lossy().into_owned(),
                                    entry.to_string_lossy().into_owned(),
                                ],
                            };
                            // cwd 一律 = runtime 目录（新版：better-sqlite3/config 相对解析；旧版等价于原 repo 布局）
                            spawn_backend(
                                node.to_str().unwrap_or("node"),
                                &args,
                                &runtime,
                                &user_env,
                            )
                        }
                        None => Err(std::io::Error::new(
                            std::io::ErrorKind::NotFound,
                            "runtime extract failed",
                        )),
                    }
                } else {
                    Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "bundled runtime missing",
                    ))
                }
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "no resource dir",
                ))
            };

            match spawned {
                Ok(child) => {
                    println!("[desktop] 已从安装包内置运行时启动后端 (pid={})", child.id());
                    app.manage(BackendHandle(Mutex::new(Some(child))));
                    return Ok(());
                }
                Err(e) => {
                    println!(
                        "[desktop] 安装包内置运行时不可用（{}），回退开发模式", e
                    );
                }
            }

            // 开发模式：从仓库启动（仓库探测仅服务此回退路径）
            match find_repo_root() {
                Some(repo) => {
                    let tsx = repo.join("node_modules/tsx/dist/cli.mjs");
                    let entry = repo.join("packages/studio/server/index.ts");
                    let args = vec![
                        tsx.to_string_lossy().into_owned(),
                        entry.to_string_lossy().into_owned(),
                    ];
                    match spawn_backend("node", &args, &repo, &user_env) {
                        Ok(child) => {
                            println!("[desktop] 已从仓库启动后端 (pid={})", child.id());
                            app.manage(BackendHandle(Mutex::new(Some(child))));
                        }
                        Err(e) => println!(
                            "[desktop] 后端启动失败: {e}\n 请手动运行: npx tsx packages/studio/server/index.ts"
                        ),
                    }
                }
                None => println!(
                    "[desktop] 未定位仓库且无内置运行时，请手动运行: npx tsx packages/studio/server/index.ts"
                ),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<BackendHandle>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        kill_backend(&mut child);
                        println!("[desktop] 已停止由本壳拉起的后端");
                    }
                }
            }
        });
}
