/**
 * server.js - WebSocket 서버
 *
 * 실시간 문서 동기화를 위한 WebSocket 서버입니다.
 * 포트: 3001 (고정)
 *
 * 주요 기능:
 * 1. 클라이언트 연결/해제 관리
 * 2. 문서별 메시지 브로드캐스트 (문서를 열고 있는 클라이언트에게만)
 * 3. 문서 참여(join) 및 퇴장(leave) 메시지 처리
 * 4. Delta 기반 편집 동기화 (변경 부분만 전송하여 패킷 절약)
 * 5. 파일/폴더 목록 메모리 저장 및 동기화 (추후 Redis로 변경 예정)
 * 6. 파일/폴더 이동 시 모든 클라이언트에 브로드캐스트
 * 7. WebRTC 시그널링 (화상통화)
 *
 * 메시지 타입:
 * - join: 문서 편집 세션 참여
 * - leave: 문서 편집 세션 퇴장
 * - edit: 문서 내용 수정 (delta 기반)
 * - sync: 문서 내용 동기화 요청/응답
 * - move: 파일/폴더 위치 이동
 * - fileList: 파일 목록 전송
 * - requestFileList: 파일 목록 요청
 * - video-join: 화상통화 참여
 * - video-leave: 화상통화 퇴장
 * - video-offer: WebRTC offer
 * - video-answer: WebRTC answer
 * - ice-candidate: ICE candidate
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
 * 문서별 클라이언트 관리 (문서를 열고 있는 클라이언트만 저장)
 * key: documentId
 * value: Map<clientId, WebSocket>
 */
const documentSessions = new Map();

/**
 * 화상통화 클라이언트 관리
 * key: clientId
 * value: WebSocket
 */
const videoClients = new Map();

/**
 * Delta를 텍스트에 적용하는 함수
 * @param {string} text - 원본 텍스트
 * @param {object} delta - { position, deleteCount, insertText }
 * @returns {string} - 변경된 텍스트
 */
function applyDelta(text, delta) {
  const before = text.slice(0, delta.position);
  const after = text.slice(delta.position + delta.deleteCount);
  return before + delta.insertText + after;
}

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
  let currentVideoClientId = null; // 화상통화용 클라이언트 ID

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
        delta,
        fileId,
        newParent,
        newIndex,
        targetPeerId,
      } = messageData;

      console.log(`📨 메시지 수신 [${type}]: 클라이언트=${clientId}`);

      // 메시지 타입별 처리
      switch (type) {
        case "join":
          // 문서 세션 참여 (WebSocket 객체도 함께 저장)
          handleJoin(documentId, clientId, ws);
          currentDocumentId = documentId;
          currentClientId = clientId;
          break;

        case "leave":
          // 문서 세션 퇴장
          handleLeave(documentId, clientId);
          currentDocumentId = null;
          break;

        case "edit":
          // 문서 편집 - Delta 기반 편집
          // 서버 메모리에 delta 적용하여 저장
          if (documentId && delta) {
            if (!documentContents[documentId]) {
              documentContents[documentId] = { content: "" };
            }
            // Delta 적용하여 내용 업데이트
            documentContents[documentId].content = applyDelta(
              documentContents[documentId].content,
              delta
            );
            console.log(
              `✏️ Delta 적용: 문서=${documentId}, 위치=${delta.position}, 삭제=${delta.deleteCount}, 삽입길이=${delta.insertText.length}`
            );
          }
          // 해당 문서를 열고 있는 클라이언트에게만 브로드캐스트 (전송자 제외)
          broadcastToDocumentSession(documentId, messageData, clientId);
          break;

        case "sync":
          // 동기화 요청 - 서버에서 최신 내용 전송
          console.log(`🔄 동기화 요청: 문서=${documentId}`);
          if (documentId) {
            // 문서가 없으면 빈 내용으로 초기화
            if (!documentContents[documentId]) {
              documentContents[documentId] = { content: "" };
            }
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

        // WebRTC 시그널링 메시지 처리
        case "video-join":
          // 화상통화 참여 - 클라이언트 등록 및 다른 참여자에게 알림
          console.log(`📹 화상통화 참여: ${clientId}`);
          currentVideoClientId = clientId;
          videoClients.set(clientId, ws);
          // 다른 화상통화 참여자에게만 알림
          broadcastToVideoClients(messageData, clientId);
          console.log(`📹 현재 화상통화 참여자: ${videoClients.size}명`);
          break;

        case "video-leave":
          // 화상통화 퇴장
          console.log(`📹 화상통화 퇴장: ${clientId}`);
          videoClients.delete(clientId);
          currentVideoClientId = null;
          // 다른 화상통화 참여자에게 알림
          broadcastToVideoClients(messageData, clientId);
          console.log(`📹 남은 화상통화 참여자: ${videoClients.size}명`);
          break;

        case "video-offer":
        case "video-answer":
        case "ice-candidate":
          // WebRTC 시그널링 메시지 - 특정 피어에게만 전달
          if (targetPeerId) {
            const targetWs = videoClients.get(targetPeerId);
            if (targetWs && targetWs.readyState === 1) {
              console.log(`📹 시그널링 [${type}]: ${clientId} -> ${targetPeerId}`);
              targetWs.send(JSON.stringify(messageData));
            } else {
              console.log(`⚠️ 대상 피어 없음: ${targetPeerId}`);
            }
          }
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

    // 화상통화 세션에서 제거
    if (currentVideoClientId) {
      videoClients.delete(currentVideoClientId);
      // 다른 참여자에게 퇴장 알림
      broadcastToVideoClients({
        type: "video-leave",
        clientId: currentVideoClientId,
      }, currentVideoClientId);
      console.log(`📹 화상통화 연결 해제: ${currentVideoClientId}, 남은 참여자: ${videoClients.size}명`);
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
 * 문서 세션 참여 처리 (WebSocket 객체 저장)
 */
function handleJoin(documentId, clientId, ws) {
  if (!documentSessions.has(documentId)) {
    documentSessions.set(documentId, new Map());
  }
  documentSessions.get(documentId).set(clientId, ws);

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
 * 해당 문서를 열고 있는 클라이언트에게만 브로드캐스트 (전송자 제외)
 * @param {string} documentId - 문서 ID
 * @param {object} messageData - 전송할 메시지
 * @param {string} excludeClientId - 제외할 클라이언트 ID (전송자)
 */
function broadcastToDocumentSession(documentId, messageData, excludeClientId) {
  if (!documentSessions.has(documentId)) {
    console.log(`⚠️ 세션 없음: 문서=${documentId}`);
    return;
  }

  const messageString = JSON.stringify(messageData);
  const sessionClients = documentSessions.get(documentId);
  let sentCount = 0;

  sessionClients.forEach((clientWs, clientId) => {
    // 전송자는 제외
    if (clientId === excludeClientId) return;

    if (clientWs.readyState === 1) {
      clientWs.send(messageString);
      sentCount++;
    }
  });

  console.log(
    `📤 문서 세션 브로드캐스트: 문서=${documentId}, ${sentCount}명에게 전송`
  );
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
 * @param {object} messageData - 전송할 메시지 데이터
 * @param {string|null} excludeClientId - 제외할 클라이언트 ID (선택적)
 */
function broadcastToAll(messageData, excludeClientId = null) {
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
 * 화상통화 참여자에게만 메시지 브로드캐스트
 * @param {object} messageData - 전송할 메시지 데이터
 * @param {string|null} excludeClientId - 제외할 클라이언트 ID (선택적)
 */
function broadcastToVideoClients(messageData, excludeClientId = null) {
  const messageString = JSON.stringify(messageData);
  let sentCount = 0;

  videoClients.forEach((clientWs, clientId) => {
    // 제외할 클라이언트 건너뛰기
    if (clientId === excludeClientId) return;
    
    if (clientWs.readyState === 1) {
      clientWs.send(messageString);
      sentCount++;
    }
  });

  console.log(`📹 화상통화 브로드캐스트: ${sentCount}명에게 전송`);
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
console.log("  - video-*       : WebRTC 화상통화 시그널링");
console.log("");
