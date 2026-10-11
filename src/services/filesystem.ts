// ---------------------------------------------------------------------------
// 文件系统服务接口
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';

export interface IFileSystemService {
    // 文件操作
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<void>;
    exists(filePath: string): boolean;
    stat(filePath: string): fs.Stats;

    // 目录操作
    readdir(dirPath: string): string[];
    mkdir(dirPath: string): Promise<void>;
    rmdir(dirPath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;

    // 路径操作
    join(...paths: string[]): string;
    dirname(filePath: string): string;
    basename(filePath: string, ext?: string): string;
    extname(filePath: string): string;

    // 临时文件
    mkdtemp(prefix: string): string;
}

export class FileSystemService implements IFileSystemService {
    public async readFile(filePath: string): Promise<string> {
        return fs.promises.readFile(filePath, 'utf8');
    }

    public async writeFile(filePath: string, content: string): Promise<void> {
        await fs.promises.writeFile(filePath, content, 'utf8');
    }

    public exists(filePath: string): boolean {
        return fs.existsSync(filePath);
    }

    public stat(filePath: string): fs.Stats {
        return fs.statSync(filePath);
    }

    public readdir(dirPath: string): string[] {
        return fs.readdirSync(dirPath);
    }

    public async mkdir(dirPath: string): Promise<void> {
        await fs.promises.mkdir(dirPath, { recursive: true });
    }

    public async rmdir(dirPath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
        await fs.promises.rm(dirPath, options);
    }

    public join(...paths: string[]): string {
        return path.join(...paths);
    }

    public dirname(filePath: string): string {
        return path.dirname(filePath);
    }

    public basename(filePath: string, ext?: string): string {
        return path.basename(filePath, ext);
    }

    public extname(filePath: string): string {
        return path.extname(filePath);
    }

    public mkdtemp(prefix: string): string {
        return fs.mkdtempSync(prefix);
    }
}
