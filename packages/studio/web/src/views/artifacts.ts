/**
 * 产物记忆视图：产物列表 / 详情 / 谱系 + 记忆召回 / 写入。
 * 产物与记忆条目字段随后端演进变化，展示时按最小已知字段提取，其余透传 JSON。
 */
import type { ApiClient } from '../api/client.js';
import { el } from '../ui/dom.js';
import { button, card, errorBox, jsonPre, spinner } from '../ui/widgets.js';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asRecord(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function artifactId(a: unknown): string {
  const rec = asRecord(a);
  if (typeof rec.id === 'string' && rec.id) return rec.id;
  if (typeof rec.artifactId === 'string' && rec.artifactId) return rec.artifactId;
  return String(rec.name ?? 'unknown');
}

export function renderArtifacts(root: HTMLElement, api: ApiClient): void {
  const listEl = el('div');
  const detailEl = el('div', null, el('div', { class: 'muted' }, '点击左侧产物查看详情'));
  const lineageOut = el('div');
  const recallInput = el('input', { type: 'text', placeholder: '输入查询词，如「测试」…' });
  const recallOut = el('div');
  const rememberInput = el('textarea', { rows: 2, placeholder: '要写入记忆的内容…' });
  const rememberOut = el('div');

  let currentArtifactId: string | undefined;

  async function loadList(): Promise<void> {
    listEl.replaceChildren(spinner('加载产物…'));
    try {
      const r = await api.getArtifactList();
      const nodes =
        r.artifacts.length === 0
          ? [el('div', { class: 'muted' }, '暂无产物')]
          : r.artifacts.map((a) => {
              const id = artifactId(a);
              const rec = asRecord(a);
              const name = typeof rec.name === 'string' ? rec.name : id;
              return el(
                'div',
                {
                  class: 'art-row',
                  onclick: () => {
                    currentArtifactId = id;
                    lineageOut.replaceChildren();
                    void loadDetail(id);
                  },
                },
                [
                  el('span', { class: 'name' }, name),
                  el('span', { class: 'meta' }, id),
                ],
              );
            });
      listEl.replaceChildren(...nodes);
    } catch (err) {
      listEl.replaceChildren(errorBox(`获取产物列表失败：${errMsg(err)}`));
    }
  }

  async function loadDetail(id: string): Promise<void> {
    detailEl.replaceChildren(spinner(`加载产物 ${id}…`));
    try {
      const r = await api.getArtifact(id);
      detailEl.replaceChildren(
        r.artifact == null ? el('div', { class: 'muted' }, '产物不存在或为空') : jsonPre(r.artifact),
      );
    } catch (err) {
      detailEl.replaceChildren(errorBox(`加载产物失败：${errMsg(err)}`));
    }
  }

  async function loadLineage(): Promise<void> {
    if (!currentArtifactId) {
      lineageOut.replaceChildren(el('div', { class: 'muted' }, '先在列表中选择一个产物'));
      return;
    }
    lineageOut.replaceChildren(spinner(`加载谱系 ${currentArtifactId}…`));
    try {
      const r = await api.getArtifactLineage(currentArtifactId);
      lineageOut.replaceChildren(jsonPre(r));
    } catch (err) {
      lineageOut.replaceChildren(errorBox(`加载谱系失败：${errMsg(err)}`));
    }
  }

  async function recall(): Promise<void> {
    const q = recallInput.value.trim();
    if (!q) return;
    recallOut.replaceChildren(spinner('检索记忆…'));
    try {
      const r = await api.recallMemory(q);
      recallOut.replaceChildren(r.hits.length === 0 ? el('div', { class: 'muted' }, '无命中') : jsonPre(r.hits));
    } catch (err) {
      recallOut.replaceChildren(errorBox(`记忆召回失败：${errMsg(err)}`));
    }
  }

  async function remember(): Promise<void> {
    const content = rememberInput.value.trim();
    if (!content) return;
    rememberOut.replaceChildren(spinner('写入记忆…'));
    try {
      const r = await api.rememberMemory(content, 'studio-web');
      rememberOut.replaceChildren(jsonPre(r));
      rememberInput.value = '';
    } catch (err) {
      rememberOut.replaceChildren(errorBox(`记忆写入失败：${errMsg(err)}`));
    }
  }

  root.replaceChildren(
    el('div', { class: 'view artifacts-view' }, [
      el('div', { class: 'grid' }, [
        card('产物 Artifacts', el('div', null, [
          el('div', { class: 'row' }, [button('刷新', () => void loadList())]),
          listEl,
        ])),
        card('详情 Detail', el('div', null, [
          detailEl,
          el('div', { class: 'row' }, [button('查看谱系', () => void loadLineage(), 'secondary')]),
          lineageOut,
        ])),
        card('记忆召回 Recall', el('div', null, [
          el('div', { class: 'row' }, [recallInput, button('检索', () => void recall())]),
          recallOut,
        ])),
        card('记忆写入 Remember', el('div', null, [
          rememberInput,
          el('div', { class: 'row' }, [button('写入', () => void remember())]),
          rememberOut,
        ])),
      ]),
    ]),
  );

  void loadList();
}
