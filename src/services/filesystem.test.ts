import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileSystemService } from './filesystem';

describe('FileSystemService', () => {
    let service: FileSystemService;
    let tempDir: string;

    beforeEach(() => {
        service = new FileSystemService();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('readFile', () => {
        it('should read file content', async () => {
            const filePath = path.join(tempDir, 'test.txt');
            fs.writeFileSync(filePath, 'hello world');

            const content = await service.readFile(filePath);

            expect(content).toBe('hello world');
        });

        it('should throw for non-existent file', async () => {
            const filePath = path.join(tempDir, 'nonexistent.txt');

            await expect(service.readFile(filePath)).rejects.toThrow();
        });
    });

    describe('writeFile', () => {
        it('should write file content', async () => {
            const filePath = path.join(tempDir, 'test.txt');

            await service.writeFile(filePath, 'hello world');

            expect(fs.readFileSync(filePath, 'utf8')).toBe('hello world');
        });

        it('should overwrite existing file', async () => {
            const filePath = path.join(tempDir, 'test.txt');
            fs.writeFileSync(filePath, 'old content');

            await service.writeFile(filePath, 'new content');

            expect(fs.readFileSync(filePath, 'utf8')).toBe('new content');
        });
    });

    describe('exists', () => {
        it('should return true for existing file', () => {
            const filePath = path.join(tempDir, 'test.txt');
            fs.writeFileSync(filePath, 'content');

            expect(service.exists(filePath)).toBe(true);
        });

        it('should return false for non-existent file', () => {
            const filePath = path.join(tempDir, 'nonexistent.txt');

            expect(service.exists(filePath)).toBe(false);
        });
    });

    describe('stat', () => {
        it('should return file stats', () => {
            const filePath = path.join(tempDir, 'test.txt');
            fs.writeFileSync(filePath, 'content');

            const stats = service.stat(filePath);

            expect(stats.isFile()).toBe(true);
            expect(stats.size).toBe(7);
        });
    });

    describe('readdir', () => {
        it('should list directory contents', () => {
            fs.writeFileSync(path.join(tempDir, 'file1.txt'), '1');
            fs.writeFileSync(path.join(tempDir, 'file2.txt'), '2');

            const files = service.readdir(tempDir);

            expect(files).toContain('file1.txt');
            expect(files).toContain('file2.txt');
        });
    });

    describe('mkdir', () => {
        it('should create directory', async () => {
            const dirPath = path.join(tempDir, 'subdir');

            await service.mkdir(dirPath);

            expect(fs.existsSync(dirPath)).toBe(true);
        });

        it('should create nested directories', async () => {
            const dirPath = path.join(tempDir, 'a', 'b', 'c');

            await service.mkdir(dirPath);

            expect(fs.existsSync(dirPath)).toBe(true);
        });
    });

    describe('rmdir', () => {
        it('should remove directory', async () => {
            const dirPath = path.join(tempDir, 'subdir');
            fs.mkdirSync(dirPath);

            await service.rmdir(dirPath, { recursive: true, force: true });

            expect(fs.existsSync(dirPath)).toBe(false);
        });
    });

    describe('path operations', () => {
        it('should join paths', () => {
            const result = service.join('/a', 'b', 'c');

            expect(result).toBe(path.join('/a', 'b', 'c'));
        });

        it('should get dirname', () => {
            const result = service.dirname('/a/b/c.txt');

            expect(result).toBe('/a/b');
        });

        it('should get basename', () => {
            const result = service.basename('/a/b/c.txt');

            expect(result).toBe('c.txt');
        });

        it('should get basename with extension', () => {
            const result = service.basename('/a/b/c.txt', '.txt');

            expect(result).toBe('c');
        });

        it('should get extname', () => {
            const result = service.extname('/a/b/c.txt');

            expect(result).toBe('.txt');
        });
    });

    describe('mkdtemp', () => {
        it('should create temp directory', () => {
            const result = service.mkdtemp(path.join(os.tmpdir(), 'prefix-'));

            expect(fs.existsSync(result)).toBe(true);
            expect(path.basename(result)).toMatch(/^prefix-/);

            fs.rmdirSync(result);
        });
    });
});
