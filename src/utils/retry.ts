// 재시도 유틸리티
import { FileNotFoundError } from '../errors';

/** 기본 딜레이 (ms) */
const BASE_DELAY_MS = 100;

/**
 * 지수 백오프 재시도 유틸리티 (AC-005.1)
 * @param fn 실행할 비동기 함수
 * @param maxRetries 최대 재시도 횟수 (기본 3)
 * @param label 로그용 라벨
 * @returns fn의 반환값
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	maxRetries: number = 3,
	label: string = 'operation',
): Promise<T> {
	let lastError: Error = new Error('No attempts made');

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error as Error;

			// AC-005.3: FileNotFoundError는 재시도하지 않음
			if (error instanceof FileNotFoundError) {
				throw error;
			}

			// 마지막 시도였으면 에러 throw
			if (attempt >= maxRetries) {
				break;
			}

			// AC-005.2: 지수 백오프 (100ms, 200ms, 400ms, ...)
			const delay = BASE_DELAY_MS * Math.pow(2, attempt);
			// AC-005.6: 재시도 로그
			console.log(`[${label}] retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${lastError.message}`);

			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}

	// AC-005.5: 마지막 에러 throw
	throw lastError;
}
