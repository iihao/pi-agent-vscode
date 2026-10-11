// ---------------------------------------------------------------------------
// 服务入口：目前只暴露 VS Code API 适配层，便于测试替换与集中访问。
// ---------------------------------------------------------------------------

import { IVSCodeService, VSCodeService } from './vscode';

export type { IVSCodeService } from './vscode';

export const services = {
    vscode: new VSCodeService() as IVSCodeService,
};

export const getVSCodeService = (): IVSCodeService => services.vscode;
