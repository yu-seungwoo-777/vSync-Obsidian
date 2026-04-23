// @MX:NOTE 3-way merge 엔진 - 라인 단위 diff 기반 자동 병합 (SPEC-P5-3WAY-001)
// 공통 조상(base)을 기준으로 서버/클라이언트 변경을 비교하여
// 다른 줄 수정 시 자동 병합, 같은 줄 수정 시 충돌 데이터 반환
import { diff_match_patch } from "diff-match-patch";

// @MX:NOTE diff 연산 결과 타입
export type DiffOperation = {
  op: number; // -1: 삭제, 0: 동일, 1: 추가
  text: string;
};

// @MX:NOTE 병합 결과 유니온 타입
export type MergeResult =
  | { type: "auto"; content: string; merge_type: "auto" }
  | { type: "conflict"; diff: DiffOperation[]; can_auto_merge: false }
  | { type: "fallback"; reason: string };

// @MX:NOTE 성능 가드: 1MB 초과 시 diff 계산 스킵
const MAX_CONTENT_SIZE = 1024 * 1024; // 1MB

// @MX:NOTE diff-match-patch 타임아웃 (초)
const DIFF_TIMEOUT = 5;

// @MX:ANCHOR 3-way merge 시도: base를 기준으로 server/incoming 변경 비교
// @MX:REASON 충돌 해결의 핵심 로직, 데이터 무손실과 사용자 경험에 직접 영향
export function attemptThreeWayMerge(
  baseContent: string | null,
  serverContent: string,
  incomingContent: string,
): MergeResult {
  // base가 null이면 3-way merge 불가 (fallback)
  if (baseContent === null) {
    return { type: "fallback", reason: "base_content_not_found" };
  }

  // 대용량 파일 성능 가드
  if (
    baseContent.length > MAX_CONTENT_SIZE ||
    serverContent.length > MAX_CONTENT_SIZE ||
    incomingContent.length > MAX_CONTENT_SIZE
  ) {
    return { type: "conflict", diff: [], can_auto_merge: false };
  }

  // 동일 내용 (false conflict) 확인
  if (serverContent === incomingContent) {
    return { type: "auto", content: serverContent, merge_type: "auto" };
  }

  // 서버나 클라이언트가 base와 동일하면 변경된 쪽 채택
  if (serverContent === baseContent) {
    return { type: "auto", content: incomingContent, merge_type: "auto" };
  }
  if (incomingContent === baseContent) {
    return { type: "auto", content: serverContent, merge_type: "auto" };
  }

  // 라인 단위로 분할
  const baseLines = baseContent === "" ? [] : baseContent.split("\n");
  const serverLines = serverContent === "" ? [] : serverContent.split("\n");
  const incomingLines = incomingContent === "" ? [] : incomingContent.split("\n");

  // 라인 단위 diff 계산 (LCS 기반)
  const serverDiff = lineDiff(baseLines, serverLines);
  const incomingDiff = lineDiff(baseLines, incomingLines);

  // 각 side가 수정한 base 라인 인덱스 집합 계산
  const serverChanged = getChangedBaseLines(serverDiff);
  const incomingChanged = getChangedBaseLines(incomingDiff);

  // 겹치는 라인이 있는지 확인
  const serverSet = new Set(serverChanged);
  const incomingSet = new Set(incomingChanged);
  const overlap = serverChanged.filter((idx) => incomingSet.has(idx));

  if (overlap.length > 0) {
    // 충돌: 겹치는 라인 존재 → diff 데이터와 함께 conflict 반환
    const dmp = new diff_match_patch();
    dmp.Diff_Timeout = DIFF_TIMEOUT;
    const conflictDiffs = dmp.diff_main(serverContent, incomingContent);
    const diffOps: DiffOperation[] = conflictDiffs.map(([op, text]) => ({
      op,
      text,
    }));

    return { type: "conflict", diff: diffOps, can_auto_merge: false };
  }

  // 자동 병합: 겹치지 않는 라인 변경 적용
  const mergedLines = applyMerges(
    baseLines,
    serverDiff,
    incomingDiff,
    serverSet,
    incomingSet,
  );

  return { type: "auto", content: mergedLines.join("\n"), merge_type: "auto" };
}

// ─── 라인 단위 Diff (LCS 기반) ──────────

// @MX:NOTE 라인 diff 항목
type LineDiffEntry = {
  op: -1 | 0 | 1; // 삭제, 동일, 추가
  baseIdx: number; // base의 라인 인덱스 (동일/삭제), -1 (추가)
  line: string;
};

// @MX:NOTE LCS 기반 라인 diff 계산
function lineDiff(base: string[], modified: string[]): LineDiffEntry[] {
  const m = base.length;
  const n = modified.length;

  // LCS 길이 테이블 계산
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (base[i - 1] === modified[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 역추적으로 diff 생성
  const result: LineDiffEntry[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && base[i - 1] === modified[j - 1]) {
      result.push({ op: 0, baseIdx: i - 1, line: base[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ op: 1, baseIdx: -1, line: modified[j - 1] });
      j--;
    } else {
      result.push({ op: -1, baseIdx: i - 1, line: base[i - 1] });
      i--;
    }
  }

  result.reverse();
  return result;
}

// @MX:NOTE diff에서 변경된 (삭제 또는 수정된) base 라인 인덱스 집합 반환
// 삭제(-1)는 해당 base 라인이 제거/수정됨을 의미
// 추가(+1)는 새 라인 삽입이며 base 라인 변경이 아님
// 수정(삭제+추가)은 삭제에서 이미 base 라인 인덱스가 추적됨
function getChangedBaseLines(diff: LineDiffEntry[]): number[] {
  const changed = new Set<number>();

  for (const entry of diff) {
    if (entry.op === -1) {
      changed.add(entry.baseIdx);
    }
  }

  return Array.from(changed).sort((a, b) => a - b);
}

// @MX:NOTE 비겹치는 라인 변경을 병합
function applyMerges(
  baseLines: string[],
  serverDiff: LineDiffEntry[],
  incomingDiff: LineDiffEntry[],
  serverSet: Set<number>,
  incomingSet: Set<number>,
): string[] {
  // serverDiff와 incomingDiff를 base 라인 인덱스 기준으로 병합
  // 각 base 라인에 대해: server가 변경했으면 server 것, incoming이 변경했으면 incoming 것 사용
  // 새로 추가된 라인은 baseIdx === -1

  // server/incoming의 base 라인별 대체 맵 구성
  const serverReplaceMap = buildReplaceMap(serverDiff);
  const incomingReplaceMap = buildReplaceMap(incomingDiff);

  const result: string[] = [];

  // base 앞에 추가된 라인들 (baseIdx 0 이전에 추가)
  const serverPrepend = serverReplaceMap.get("before-0");
  const incomingPrepend = incomingReplaceMap.get("before-0");
  if (serverPrepend) result.push(...serverPrepend);
  if (incomingPrepend) result.push(...incomingPrepend);

  for (let i = 0; i < baseLines.length; i++) {
    const serverReplacement = serverReplaceMap.get(`replace-${i}`);
    const incomingReplacement = incomingReplaceMap.get(`replace-${i}`);
    const serverInserted = serverReplaceMap.get(`after-${i}`);
    const incomingInserted = incomingReplaceMap.get(`after-${i}`);

    if (serverSet.has(i)) {
      // 서버가 이 base 라인을 변경
      if (serverReplacement) {
        result.push(...serverReplacement);
      }
    } else if (incomingSet.has(i)) {
      // 클라이언트가 이 base 라인을 변경
      if (incomingReplacement) {
        result.push(...incomingReplacement);
      }
    } else {
      // 변경되지 않은 라인
      result.push(baseLines[i]);
    }

    // 이 라인 이후에 삽입된 라인들
    if (serverInserted) result.push(...serverInserted);
    if (incomingInserted) result.push(...incomingInserted);
  }

  return result;
}

// @MX:NOTE diff를 맵으로 변환
// key: "before-{idx}" (라인 앞 삽입), "replace-{idx}" (라인 대체), "after-{idx}" (라인 뒤 삽입)
function buildReplaceMap(
  diff: LineDiffEntry[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  let i = 0;
  while (i < diff.length) {
    const entry = diff[i];

    if (entry.op === 0) {
      // 동일: 다음으로
      i++;
      continue;
    }

    if (entry.op === -1) {
      // 삭제: 다음 항목이 추가이면 수정, 아니면 순수 삭제
      const baseIdx = entry.baseIdx;
      const replacementLines: string[] = [];
      let j = i + 1;

      // 연속된 삭제 수집
      while (j < diff.length && diff[j].op === -1) {
        j++;
      }

      // 뒤따르는 추가 수집
      while (j < diff.length && diff[j].op === 1) {
        replacementLines.push(diff[j].line);
        j++;
      }

      // 첫 삭제 항목의 baseIdx에 대체 라인 저장
      map.set(`replace-${baseIdx}`, replacementLines);
      i = j;
      continue;
    }

    if (entry.op === 1) {
      // 추가 (앞에 삭제가 없는 순수 삽입)
      // 이전 동일 항목의 baseIdx 뒤에 삽입, 또는 맨 앞
      const addedLines: string[] = [];
      let j = i;
      while (j < diff.length && diff[j].op === 1) {
        addedLines.push(diff[j].line);
        j++;
      }

      // 삽입 위치 결정: 이전 동일 항목의 baseIdx
      let insertAfterIdx = -1;
      for (let k = i - 1; k >= 0; k--) {
        if (diff[k].op === 0) {
          insertAfterIdx = diff[k].baseIdx;
          break;
        }
      }

      if (insertAfterIdx === -1) {
        // base 맨 앞에 삽입
        map.set(`before-0`, addedLines);
      } else {
        // 특정 base 라인 뒤에 삽입
        map.set(`after-${insertAfterIdx}`, addedLines);
      }

      i = j;
      continue;
    }

    i++;
  }

  return map;
}
