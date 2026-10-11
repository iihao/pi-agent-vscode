// ---------------------------------------------------------------------------
// 服务容器（依赖注入）
// ---------------------------------------------------------------------------

import { IVSCodeService, VSCodeService } from './vscode';
import { IFileSystemService, FileSystemService } from './filesystem';
import { IPiSdkAdapter } from './pi-sdk';

export interface ServiceContainer {
    vscode: IVSCodeService;
    filesystem: IFileSystemService;
    // piSdk 需要延迟初始化，因为需要配置
    piSdk?: IPiSdkAdapter;
    setPiSdk(adapter: IPiSdkAdapter): void;
    getPiSdk(): IPiSdkAdapter | undefined;
}

class ServiceContainerImpl implements ServiceContainer {
    public readonly vscode: IVSCodeService;
    public readonly filesystem: IFileSystemService;
    public piSdk?: IPiSdkAdapter;

    constructor() {
        this.vscode = new VSCodeService();
        this.filesystem = new FileSystemService();
    }

    public setPiSdk(adapter: IPiSdkAdapter): void {
        this.piSdk = adapter;
    }

    public getPiSdk(): IPiSdkAdapter | undefined {
        return this.piSdk;
    }
}

// 单例导出
export const services = new ServiceContainerImpl();

// 便捷导出
export const getVSCodeService = (): IVSCodeService => services.vscode;
export const getFileSystemService = (): IFileSystemService => services.filesystem;
export const getPiSdkService = (): IPiSdkAdapter | undefined => services.getPiSdk();
