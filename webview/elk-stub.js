// 构建裁剪：不打包 elkjs（约 1.4MB）。
//
// Mermaid 把 elk 作为「可选布局引擎」懒加载；当某张图显式要求 ELK 布局时，
// 若未注册 elk，Mermaid 的 getRegisteredLayoutAlgorithm() 会自动回退到 dagre。
// 因此这里用一个空实现替代 elkjs，仅影响「显式要求 elk 布局」的图的排布风格，
// 不会导致渲染失败。
export default class ElkStub {
    layout() {
        return Promise.reject(new Error('elk layout is not bundled (fallback to dagre)'));
    }
}
