/** Firmware workflow artifact types */

export interface SourceCode {
  chip: string;
  files: string[];
  language: 'c' | 'asm';
  generatedFrom?: string;
}

export interface HexBinary {
  path: string;
  size: number;
  chip: string;
}

export interface XBINBinary {
  path: string;
  size: number;
  chip: string;
  romWords: number;
}

export interface BuildReport {
  success: boolean;
  chip: string;
  romUsage: number;
  romTotal: number;
  ramUsage: number;
  ramTotal: number;
  hexPath?: string;
  xbinPath?: string;
  mapPath?: string;
  errors?: string[];
  timestamp: string;
}

export interface RegisterDump {
  registers: Record<string, number>;
  pcl: number;
  status: number;
  acc: number;
}
