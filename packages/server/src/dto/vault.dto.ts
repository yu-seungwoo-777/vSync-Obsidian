// @MX:NOTE 볼트 관련 DTO 변환 함수

// 볼트 응답은 현재 wire format과 동일하게 유지
// 향후 서비스 계층이 camelCase로 전환되면 변환 로직 추가

export function toWireVaultCreateResponse(result: {
  vaultId: string;
  name: string;
  createdAt: Date;
}) {
  return {
    vault_id: result.vaultId,
    name: result.name,
    created_at: result.createdAt instanceof Date ? result.createdAt.toISOString() : String(result.createdAt),
  };
}
