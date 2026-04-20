// SHA-256 해시 유틸리티
// Web Crypto API의 crypto.subtle.digest 사용
// REQ-P4-014: 충돌 감지를 위한 해시 비교
// REQ-P6-010: ArrayBuffer 입력 지원

// Obsidian 모바일/데스크톱 환경에서는 crypto가 전역으로 사용 가능하나,
// Node.js 테스트 환경에서는 node:crypto에서 가져와야 함
 
type CryptoDigest = { subtle: { digest: (algo: string, data: Uint8Array) => Promise<ArrayBuffer> } };

function getCrypto(): CryptoDigest {
	// 글로벌 crypto (브라우저/Obsidian 환경)
	if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
		return globalThis.crypto as unknown as CryptoDigest;
	}
	// Node.js 환경 폴리필
	try {
		const nodeCrypto = require('crypto'); // eslint-disable-line @typescript-eslint/no-require-imports -- Node.js 테스트 환경 전용 런타임 폴리필
		return {
			subtle: {
				digest: async (algo: string, data: Uint8Array): Promise<ArrayBuffer> => {
					const algoName = algo.toLowerCase().replace('-', '');
					const hash = nodeCrypto.createHash(algoName);
					hash.update(data);
					return hash.digest().buffer as ArrayBuffer;
				},
			},
		};
	} catch {
		throw new Error('crypto.subtle is not available in this environment');
	}
}

/** ArrayBuffer를 hex 문자열로 변환 */
function bufferToHex(hashBuffer: ArrayBuffer): string {
	const hashArray = new Uint8Array(hashBuffer);
	return Array.from(hashArray)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/** 문자열 또는 ArrayBuffer의 SHA-256 해시를 hex 문자열로 반환 */
export async function computeHash(content: string | ArrayBuffer): Promise<string> {
	let data: Uint8Array;

	if (typeof content === 'string') {
		// 텍스트를 UTF-8 바이트 배열로 변환
		const encoder = new TextEncoder();
		data = encoder.encode(content);
	} else {
		// ArrayBuffer를 직접 사용
		data = new Uint8Array(content);
	}

	// Web Crypto API로 SHA-256 해시 계산
	const crypto = getCrypto();
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);

	return bufferToHex(hashBuffer);
}
