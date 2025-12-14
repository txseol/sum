/**
 * types.ts - 프로젝트 타입 정의
 *
 * 파일 탐색기와 WebSocket 동기화에 필요한 타입들을 정의합니다.
 * - ExplorerFileData: 파일 탐색기에서 사용하는 파일/폴더 데이터 타입
 * - DocumentContent: 문서 내용을 저장하는 타입 (WebSocket 동기화용)
 * - WebSocketMessage: WebSocket 메시지 타입
 * - ActiveDocument: 현재 활성화된 문서 상태 타입
 * - EditDelta: 변경된 부분만 전송하기 위한 델타 타입
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

/**
 * EditDelta - 변경된 부분만 전송하기 위한 델타 타입
 * 전체 텍스트 대신 변경 정보만 전송하여 패킷 절약
 *
 * 예: "Hello World"에서 "Hello Korea"로 변경 시
 * { position: 6, deleteCount: 5, insertText: "Korea" }
 */
export interface EditDelta {
  position: number; // 변경 시작 위치
  deleteCount: number; // 삭제할 문자 수
  insertText: string; // 삽입할 텍스트
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
  content?: string; // 문서 전체 내용 (sync 응답 시 사용)
  userName?: string; // 사용자 이름 (추후 사용)
  // 델타 편집 관련 (edit 시 사용) - 패킷 절약을 위해 변경된 부분만 전송
  delta?: EditDelta;
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
