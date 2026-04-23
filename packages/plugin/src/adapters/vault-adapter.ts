// 파일 동기화를 위한 Obsidian Vault API 추상화 인터페이스
// SyncEngine은 이 인터페이스를 통해서만 파일 I/O를 수행 (Obsidian 의존성 없음)

/** Vault 어댑터 인터페이스 */
export interface VaultAdapter {
	read(path: string): Promise<string>;
	readIfExists(path: string): Promise<string | null>;
	write(path: string, content: string): Promise<void>;
	delete(path: string): Promise<void>;
	getFiles(): Array<{ path: string }>;
	on(event: string, handler: (...args: unknown[]) => void): void;
	off(event: string, handler: (...args: unknown[]) => void): void;
	// 바이너리 지원 (REQ-P6-004 ~ REQ-P6-006)
	readBinary(path: string): Promise<ArrayBuffer>;
	readBinaryIfExists(path: string): Promise<ArrayBuffer | null>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	// REQ-API-002: fileManager.renameFile - wiki link 보존
	renameFile(oldPath: string, newPath: string): Promise<void>;
	// REQ-API-003: vault.process - 원자적 read-modify-write
	process(path: string, fn: (content: string) => string | null): Promise<string | null>;
	// REQ-API-005: vault.cachedRead - 캐시 우선 읽기
	cachedRead(path: string): Promise<string | null>;
}
