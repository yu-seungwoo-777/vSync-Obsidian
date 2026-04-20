// 커스텀 에러 타입
// REQ-R5-004: Vault 작업 전용 에러 타입

/** 파일을 찾을 수 없을 때 발생하는 에러 (AC-004.1) */
export class FileNotFoundError extends Error {
	readonly path: string;

	constructor(path: string, message?: string) {
		super(message ?? `File not found: ${path}`);
		this.name = 'FileNotFoundError';
		this.path = path;
	}
}

/** Vault 읽기 작업 중 발생하는 에러 (AC-004.2) */
export class VaultReadError extends Error {
	readonly path: string;
	readonly cause?: Error;

	constructor(path: string, cause?: Error) {
		super(`Failed to read vault file: ${path}`);
		this.name = 'VaultReadError';
		this.path = path;
		this.cause = cause;
	}
}

/** Vault 쓰기 작업 중 발생하는 에러 (AC-004.3) */
export class VaultWriteError extends Error {
	readonly path: string;
	readonly cause?: Error;

	constructor(path: string, cause?: Error) {
		super(`Failed to write vault file: ${path}`);
		this.name = 'VaultWriteError';
		this.path = path;
		this.cause = cause;
	}
}
