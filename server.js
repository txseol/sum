/**
 * server.js - WebSocket 서버
 *
 * 실시간 문서 동기화를 위한 WebSocket 서버입니다.
 * 포트: 3001 (고정)
 *
 * 주요 기능:
 * 1. 클라이언트 연결/해제 관리
 * 2. 문서별 메시지 브로드캐스트
 * 3. 문서 참여(join) 및 퇴장(leave) 메시지 처리
 * 4. 실시간 편집 내용 동기화
 * 5. 파일/폴더 목록 메모리 저장 및 동기화 (추후 Redis로 변경 예정)
 * 6. 파일/폴더 이동 시 모든 클라이언트에 브로드캐스트
 *
 * 메시지 타입:
 * - join: 문서 편집 세션 참여
 * - leave: 문서 편집 세션 퇴장
 * - edit: 문서 내용 수정
 * - sync: 문서 내용 동기화 요청/응답
 * - move: 파일/폴더 위치 이동
 * - fileList: 파일 목록 전송
 * - requestFileList: 파일 목록 요청
 *
 * 실행 방법:
 * node server.js
 */

const { WebSocketServer } = require("ws");

// WebSocket 서버 포트 (고정값: 3001)
const WS_PORT = 3001;

// WebSocket 서버 생성
const wss = new WebSocketServer({
  port: WS_PORT,
  host: "0.0.0.0", // 모든 네트워크 인터페이스에서 접속 허용
});

/**
 * 문서별 클라이언트 관리
 * key: documentId
 * value: Set of clientIds
 */
const documentSessions = new Map();

/**
 * 파일/폴더 목록 메모리 저장소
 * 추후 Redis로 변경 예정
 */
let fileList = [
  // 폴더 목록
  {
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    name: "Projects",
    type: 0,
    dirPosition: [null, 0],
  },
  {
    id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    name: "Photos",
    type: 0,
    dirPosition: [null, 1],
  },
  {
    id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
    name: "Music",
    type: 0,
    dirPosition: ["Photos", 0],
  },
  // 파일 목록
  {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Document.txt",
    type: 1,
    dirPosition: ["Projects", 0],
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    name: "Image.png",
    type: 1,
    dirPosition: ["Photos", 1],
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440002",
    name: "Presentation.pptx",
    type: 1,
    dirPosition: ["Music", 0],
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440003",
    name: "Notes.md",
    type: 1,
    dirPosition: ["Music", 1],
  },
];

/**
 * 문서 내용 저장소 (추후 Redis로 변경 예정)
 */
const documentContents = {
  "550e8400-e29b-41d4-a716-446655440000": {
    content:
      "이것은 Document.txt의 초기 내용입니다.\n여기에 자유롭게 작성해보세요.",
  },
  "550e8400-e29b-41d4-a716-446655440001": {
    content: "[이미지 파일입니다. 텍스트 편집이 제한됩니다.]",
  },
  "550e8400-e29b-41d4-a716-446655440002": {
    content:
      "프레젠테이션 슬라이드 1\n\n제목: 프로젝트 소개\n내용: 여기에 내용을 작성하세요.",
  },
  "550e8400-e29b-41d4-a716-446655440003": {
    content: "# 메모 노트\n\n- 첫 번째 항목\n- 두 번째 항목\n- 세 번째 항목",
  },
};

/**
 * 클라이언트 연결 이벤트 핸들러
 */
wss.on("connection", (ws) => {
  console.log("✅ 클라이언트 연결됨");

  // 이 클라이언트가 참여한 문서 ID (연결 해제 시 정리용)
  let currentDocumentId = null;
  let currentClientId = null;

  /**
   * 메시지 수신 핸들러
   */
  ws.on("message", (data) => {
    try {
      const messageData = JSON.parse(data.toString());
      const {
        type,
        documentId,
        clientId,
        content,
        fileId,
        newParent,
        newIndex,
      } = messageData;

      console.log(`📨 메시지 수신 [${type}]: 클라이언트=${clientId}`);

      // 메시지 타입별 처리
      switch (type) {
        case "join":
          // 문서 세션 참여
          handleJoin(documentId, clientId);
          currentDocumentId = documentId;
          currentClientId = clientId;
          break;

        case "leave":
          // 문서 세션 퇴장
          handleLeave(documentId, clientId);
          break;

        case "edit":
          // 문서 편집 - 같은 문서를 보는 모든 클라이언트에게 브로드캐스트
          // 서버 메모리에 문서 내용 저장
          if (documentId && content !== undefined) {
            if (!documentContents[documentId]) {
              documentContents[documentId] = { content: "" };
            }
            documentContents[documentId].content = content;
          }
          broadcastToAll(messageData);
          break;

        case "sync":
          // 동기화 요청 - 서버에서 최신 내용 전송
          console.log(`🔄 동기화 요청: 문서=${documentId}`);
          if (documentId && documentContents[documentId]) {
            ws.send(
              JSON.stringify({
                type: "sync",
                documentId,
                clientId: "server",
                content: documentContents[documentId].content,
              })
            );
          }
          break;

        case "requestFileList":
          // 파일 목록 요청 - 현재 파일 목록 전송
          console.log(`📂 파일 목록 요청: 클라이언트=${clientId}`);
          ws.send(
            JSON.stringify({
              type: "fileList",
              clientId: "server",
              fileList: fileList,
            })
          );
          break;

        case "move":
          // 파일/폴더 이동
          handleMove(fileId, newParent, newIndex, clientId);
          break;

        default:
          console.log(`⚠️ 알 수 없는 메시지 타입: ${type}`);
      }
    } catch (error) {
      console.error("❌ 메시지 파싱 오류:", error);
    }
  });

  /**
   * 연결 해제 핸들러
   */
  ws.on("close", () => {
    console.log("❎ 클라이언트 연결 해제");

    // 참여 중인 문서 세션에서 제거
    if (currentDocumentId && currentClientId) {
      handleLeave(currentDocumentId, currentClientId);
    }
  });

  /**
   * 에러 핸들러
   */
  ws.on("error", (error) => {
    console.error("❌ WebSocket 에러:", error);
  });
});

/**
 * 문서 세션 참여 처리
 */
function handleJoin(documentId, clientId) {
  if (!documentSessions.has(documentId)) {
    documentSessions.set(documentId, new Set());
  }
  documentSessions.get(documentId).add(clientId);

  const participantCount = documentSessions.get(documentId).size;
  console.log(
    `👋 세션 참여: 문서=${documentId}, 현재 참여자=${participantCount}명`
  );
}

/**
 * 문서 세션 퇴장 처리
 */
function handleLeave(documentId, clientId) {
  if (documentSessions.has(documentId)) {
    documentSessions.get(documentId).delete(clientId);

    const participantCount = documentSessions.get(documentId).size;
    console.log(
      `👋 세션 퇴장: 문서=${documentId}, 남은 참여자=${participantCount}명`
    );

    if (participantCount === 0) {
      documentSessions.delete(documentId);
      console.log(`🗑️ 빈 세션 제거: 문서=${documentId}`);
    }
  }
}

/**
 * 파일/폴더 이동 처리
 * @param {string} fileId - 이동할 파일/폴더 ID
 * @param {string|null} newParent - 새 부모 폴더명 (null이면 최상위)
 * @param {number} newIndex - 새 순서
 * @param {string} clientId - 요청한 클라이언트 ID
 */
function handleMove(fileId, newParent, newIndex, clientId) {
  console.log(`📦 파일 이동: ${fileId} -> ${newParent || "root"}[${newIndex}]`);

  // 파일 찾기
  const fileIndex = fileList.findIndex((f) => f.id === fileId);
  if (fileIndex === -1) {
    console.log(`⚠️ 파일을 찾을 수 없음: ${fileId}`);
    return;
  }

  const file = fileList[fileIndex];
  const oldParent = file.dirPosition[0];
  const oldIndex = file.dirPosition[1];

  // 같은 위치면 무시
  if (oldParent === newParent && oldIndex === newIndex) {
    return;
  }

  // 기존 위치의 다른 파일들 순서 업데이트 (제거 후)
  fileList.forEach((f) => {
    if (f.dirPosition[0] === oldParent && f.dirPosition[1] > oldIndex) {
      f.dirPosition[1]--;
    }
  });

  // 새 위치의 다른 파일들 순서 업데이트 (삽입 전)
  fileList.forEach((f) => {
    if (f.dirPosition[0] === newParent && f.dirPosition[1] >= newIndex) {
      f.dirPosition[1]++;
    }
  });

  // 파일 위치 업데이트
  file.dirPosition = [newParent, newIndex];

  console.log(`✅ 파일 이동 완료: ${file.name}`);

  // 모든 클라이언트에게 업데이트된 파일 목록 브로드캐스트
  broadcastToAll({
    type: "fileList",
    clientId: clientId,
    fileList: fileList,
  });
}

/**
 * 모든 클라이언트에게 메시지 브로드캐스트
 */
function broadcastToAll(messageData) {
  const messageString = JSON.stringify(messageData);
  let sentCount = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(messageString);
      sentCount++;
    }
  });

  console.log(`📤 브로드캐스트: ${sentCount}개 클라이언트`);
}

/**
 * 서버 시작 로그
 */
console.log("═══════════════════════════════════════════════════════════");
console.log("🚀 WebSocket 서버 시작");
console.log(`📡 주소: ws://localhost:${WS_PORT}`);
console.log("═══════════════════════════════════════════════════════════");
console.log("");
console.log("📋 지원 메시지 타입:");
console.log("  - join          : 문서 편집 세션 참여");
console.log("  - leave         : 문서 편집 세션 퇴장");
console.log("  - edit          : 문서 내용 편집 (브로드캐스트)");
console.log("  - sync          : 문서 동기화 요청");
console.log("  - move          : 파일/폴더 위치 이동");
console.log("  - requestFileList: 파일 목록 요청");
console.log("  - fileList      : 파일 목록 전송");
console.log("");
