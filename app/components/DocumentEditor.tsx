/**
 * DocumentEditor.tsx - WebSocket 기반 실시간 문서 편집기 컴포넌트
 *
 * 주요 기능:
 * 1. WebSocket 연결을 통한 실시간 텍스트 동기화
 * 2. 서버에서 문서 내용 로드 (sync 메시지)
 * 3. 한글 IME 조합 처리 (compositionstart/compositionend)
 * 4. 문서 ID별로 독립적인 편집 세션 관리
 * 5. 문서 닫기 기능
 *
 * Props:
 * - document: 현재 편집 중인 문서 정보 (id, name)
 * - onClose: 문서 닫기 버튼 클릭 시 호출되는 콜백
 *
 * WebSocket 서버: ws://localhost:3001 (고정 포트)
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { WebSocketMessage, ActiveDocument } from "../types";

// WebSocket 서버 포트 (고정값: 3001)
const WS_PORT = 3001;

interface DocumentEditorProps {
  document: ActiveDocument; // 현재 편집 중인 문서 정보
  onClose: () => void; // 문서 닫기 핸들러
}

export default function DocumentEditor({
  document,
  onClose,
}: DocumentEditorProps) {
  // 문서 내용 상태
  const [content, setContent] = useState("");

  // 로딩 상태
  const [isLoading, setIsLoading] = useState(true);

  // 한글 IME 조합 상태 관리
  const [isComposing, setIsComposing] = useState(false);

  // WebSocket 연결 참조
  const ws = useRef<WebSocket | null>(null);

  // 클라이언트 고유 ID (세션 동안 유지)
  const clientId = useRef<string>(Math.random().toString(36).substr(2, 9));

  // 한글 조합 타이머 참조
  const compositionTimer = useRef<NodeJS.Timeout | null>(null);

  /**
   * WebSocket 연결 설정 및 메시지 핸들링
   * 문서가 변경될 때마다 새로운 연결을 설정합니다.
   */
  useEffect(() => {
    setIsLoading(true);

    // WebSocket 서버에 연결 (포트 3001 고정)
    ws.current = new WebSocket(`ws://localhost:${WS_PORT}`);

    // 연결 성공 시 join 메시지 및 sync 요청 전송
    ws.current.onopen = () => {
      console.log("WebSocket 연결됨 - 문서:", document.name);

      // 문서 참여 메시지 전송
      const joinMessage: WebSocketMessage = {
        type: "join",
        documentId: document.id,
        clientId: clientId.current,
      };
      ws.current?.send(JSON.stringify(joinMessage));

      // 서버에 문서 내용 동기화 요청
      const syncMessage: WebSocketMessage = {
        type: "sync",
        documentId: document.id,
        clientId: clientId.current,
      };
      ws.current?.send(JSON.stringify(syncMessage));
    };

    // 메시지 수신 핸들러
    ws.current.onmessage = (e) => {
      const data: WebSocketMessage = JSON.parse(e.data);

      // 같은 문서에 대한 메시지만 처리
      if (data.documentId !== document.id) return;

      // sync 응답 처리 - 서버에서 초기 내용 수신
      if (data.type === "sync" && data.content !== undefined) {
        console.log("문서 내용 로드 완료:", document.name);
        setContent(data.content);
        setIsLoading(false);
        return;
      }

      // edit 메시지 처리 - 다른 사용자의 편집 내용 반영
      if (
        data.type === "edit" &&
        data.clientId !== clientId.current &&
        data.content !== undefined
      ) {
        setContent(data.content);
      }
    };

    ws.current.onerror = (e) => {
      console.log("WebSocket 에러:", e);
      setIsLoading(false);
    };

    // 컴포넌트 언마운트 시 정리
    return () => {
      // leave 메시지 전송
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        const leaveMessage: WebSocketMessage = {
          type: "leave",
          documentId: document.id,
          clientId: clientId.current,
        };
        ws.current.send(JSON.stringify(leaveMessage));
      }

      ws.current?.close();

      // 타이머 정리
      if (compositionTimer.current) {
        clearTimeout(compositionTimer.current);
      }
    };
  }, [document.id, document.name]);

  /**
   * WebSocket을 통해 메시지 전송
   * @param value - 전송할 문서 내용
   */
  const sendMessage = useCallback(
    (value: string) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        const message: WebSocketMessage = {
          type: "edit",
          documentId: document.id,
          clientId: clientId.current,
          content: value,
        };
        ws.current.send(JSON.stringify(message));
      }
    },
    [document.id]
  );

  /**
   * 한글 IME 조합 완료 처리
   * 조합이 끝났을 때 상태 업데이트 및 메시지 전송
   */
  const completeComposition = useCallback(
    (value: string) => {
      if (compositionTimer.current) {
        clearTimeout(compositionTimer.current);
        compositionTimer.current = null;
      }
      setIsComposing(false);
      setContent(value);
      sendMessage(value);
    },
    [sendMessage]
  );

  /**
   * 한글 IME 조합 시작/종료 이벤트 핸들러
   */
  const handleComposition = (
    e: React.CompositionEvent<HTMLTextAreaElement>
  ) => {
    if (e.type === "compositionstart") {
      // 조합 시작
      setIsComposing(true);
    } else if (e.type === "compositionend") {
      // 조합 종료 - 최종 값으로 업데이트
      const value = (e.target as HTMLTextAreaElement).value;
      completeComposition(value);
    }
  };

  /**
   * 텍스트 입력 변경 핸들러
   * 한글 조합 중일 때는 딜레이를 두고, 그 외에는 즉시 전송
   */
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);

    // 한글 조합 중일 때는 타이머를 사용하여 디바운싱
    if ((e.nativeEvent as InputEvent).isComposing || isComposing) {
      if (compositionTimer.current) {
        clearTimeout(compositionTimer.current);
      }
      compositionTimer.current = setTimeout(
        () => completeComposition(value),
        200 // 200ms 딜레이
      );
      return;
    }

    // 일반 입력은 즉시 전송
    sendMessage(value);
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-lg overflow-hidden">
      {/* 문서 헤더 영역 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b">
        <div className="flex items-center gap-2">
          {/* 문서 아이콘 */}
          <span className="text-blue-500">📄</span>
          {/* 문서 이름 */}
          <span className="font-medium text-gray-700">{document.name}</span>
        </div>

        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          className="px-2 py-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
          title="문서 닫기"
        >
          ✕
        </button>
      </div>

      {/* 편집기 영역 */}
      <div className="flex-1 p-2">
        {isLoading ? (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <span>문서 로딩 중...</span>
          </div>
        ) : (
          <textarea
            className="w-full h-full p-3 border border-gray-200 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            value={content}
            onChange={handleChange}
            onCompositionStart={handleComposition}
            onCompositionEnd={handleComposition}
            placeholder="여기에 입력하세요. 다른 사용자와 실시간으로 동기화됩니다."
          />
        )}
      </div>

      {/* 상태 표시 영역 */}
      <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-500">
        <span>실시간 동기화 활성화</span>
        <span className="ml-2 inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
      </div>
    </div>
  );
}
