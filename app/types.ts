/**
 * types.ts - 프로젝트 타입 정의
 *
 * 파일 탐색기와 WebSocket 동기화에 필요한 타입들을 정의합니다.
 * - ExplorerFileData: 파일 탐색기에서 사용하는 파일/폴더 데이터 타입
 * - DocumentContent: 문서 내용을 저장하는 타입 (WebSocket 동기화용)
 * - WebSocketMessage: WebSocket 메시지 타입
 * - ActiveDocument: 현재 활성화된 문서 상태 타입
 */

// 파일 탐색기에서 사용하는 파일/폴더 데이터 타입
// type: 0 = folder, type: 1 = file
// dirPosition: [부모폴더명 또는 null, 위치인덱스]
export interface ExplorerFileData {
  id: string;
  name: string;
  type: number; // 0: 폴더, 1: 파일
  dirPosition: [string | null, number]; // [부모폴더명, 순서]
}

// 문서 내용을 저장하는 타입 (추후 실제 DB 연동 시 사용)
export interface DocumentContent {
  id: string; // 문서 고유 ID
  name: string; // 문서 이름
  content: string; // 문서 내용
  lastModified: Date; // 마지막 수정 시간
}

// WebSocket 메시지 타입
export interface WebSocketMessage {
  type:
    | "edit"
    | "sync"
    | "join"
    | "leave"
    | "move"
    | "fileList"
    | "requestFileList";
  documentId?: string; // 편집 중인 문서 ID (edit, join, leave 시 사용)
  clientId: string; // 클라이언트 고유 ID
  content?: string; // 문서 내용 (edit, sync 시 사용)
  userName?: string; // 사용자 이름 (추후 사용)
  // 파일 이동 관련 (move 시 사용)
  fileId?: string; // 이동할 파일/폴더 ID
  newParent?: string | null; // 새 부모 폴더명 (null이면 최상위)
  newIndex?: number; // 새 순서
  // 파일 목록 동기화 (fileList 시 사용)
  fileList?: ExplorerFileData[];
}

// 현재 활성화된 문서 상태 타입
export interface ActiveDocument {
  id: string;
  name: string;
  content: string;
}
