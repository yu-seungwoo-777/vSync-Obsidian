// 워크스페이스/UI 제어를 위한 Obsidian Workspace API 추상화 인터페이스
// main.ts는 이 인터페이스를 통해서만 UI/워크스페이스 API를 호출

export interface WorkspaceAdapter {
	onLayoutReady(callback: () => void): void;
	openFile(filePath: string): Promise<void>;
	getLeavesOfType(viewType: string): Array<{ detach: () => void }>;
	openViewInRightLeaf(viewType: string): Promise<void>;
}
