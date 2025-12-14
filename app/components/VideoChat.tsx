/**
 * VideoChat.tsx - WebRTC 기반 화상통화 컴포넌트
 *
 * 주요 기능:
 * 1. WebRTC를 이용한 P2P 화상통화
 * 2. WebSocket을 통한 시그널링 (offer/answer/ice-candidate)
 * 3. 다중 사용자 지원
 * 4. 마이크/카메라 on/off
 * 5. 통화 시작/종료
 *
 * WebSocket 서버: ws://localhost:3001 (고정 포트)
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getWebSocketUrl } from "../utils/websocket";

interface PeerConnection {
  peerId: string;
  connection: RTCPeerConnection;
  stream?: MediaStream;
}

interface VideoChatProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function VideoChat({ isOpen, onClose }: VideoChatProps) {
  // 로컬 스트림 (내 카메라/마이크)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  // 원격 피어들의 스트림
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(
    new Map()
  );
  // 연결 상태
  const [isConnected, setIsConnected] = useState(false);
  // 카메라/마이크 상태
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  // 로딩 상태
  const [isLoading, setIsLoading] = useState(false);

  // Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const clientIdRef = useRef<string>(
    Math.random().toString(36).substring(2, 11)
  );

  // ICE 서버 설정 (STUN 서버)
  const iceServers: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  /**
   * 미디어 스트림 가져오기
   */
  const getLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (error) {
      console.error("미디어 접근 오류:", error);
      alert("카메라/마이크 접근에 실패했습니다.");
      return null;
    }
  }, []);

  /**
   * RTCPeerConnection 생성
   */
  const createPeerConnection = useCallback(
    (peerId: string, stream: MediaStream): RTCPeerConnection => {
      const pc = new RTCPeerConnection(iceServers);

      // 로컬 스트림의 트랙을 추가
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // ICE candidate 이벤트
      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "ice-candidate",
              candidate: event.candidate,
              targetPeerId: peerId,
              clientId: clientIdRef.current,
            })
          );
        }
      };

      // 원격 스트림 수신
      pc.ontrack = (event) => {
        console.log("원격 스트림 수신:", peerId);
        setRemoteStreams((prev) => {
          const newMap = new Map(prev);
          newMap.set(peerId, event.streams[0]);
          return newMap;
        });
      };

      // 연결 상태 변경
      pc.onconnectionstatechange = () => {
        console.log(`피어 ${peerId} 연결 상태:`, pc.connectionState);
        if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed"
        ) {
          // 연결 해제된 피어 정리
          setRemoteStreams((prev) => {
            const newMap = new Map(prev);
            newMap.delete(peerId);
            return newMap;
          });
          peerConnectionsRef.current.delete(peerId);
        }
      };

      peerConnectionsRef.current.set(peerId, pc);
      return pc;
    },
    []
  );

  /**
   * WebSocket 메시지 핸들러
   */
  const handleWebSocketMessage = useCallback(
    async (event: MessageEvent) => {
      const data = JSON.parse(event.data);

      // 자신의 메시지는 무시
      if (data.clientId === clientIdRef.current) return;

      switch (data.type) {
        case "video-join": {
          // 새 피어가 참여함 - offer 전송
          console.log("새 피어 참여:", data.clientId);
          if (!localStream) return;

          const pc = createPeerConnection(data.clientId, localStream);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          wsRef.current?.send(
            JSON.stringify({
              type: "video-offer",
              offer,
              targetPeerId: data.clientId,
              clientId: clientIdRef.current,
            })
          );
          break;
        }

        case "video-offer": {
          // offer 수신 - answer 전송
          if (data.targetPeerId !== clientIdRef.current) return;
          console.log("Offer 수신:", data.clientId);
          if (!localStream) return;

          const pc = createPeerConnection(data.clientId, localStream);
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          wsRef.current?.send(
            JSON.stringify({
              type: "video-answer",
              answer,
              targetPeerId: data.clientId,
              clientId: clientIdRef.current,
            })
          );
          break;
        }

        case "video-answer": {
          // answer 수신
          if (data.targetPeerId !== clientIdRef.current) return;
          console.log("Answer 수신:", data.clientId);
          const pc = peerConnectionsRef.current.get(data.clientId);
          if (pc) {
            await pc.setRemoteDescription(
              new RTCSessionDescription(data.answer)
            );
          }
          break;
        }

        case "ice-candidate": {
          // ICE candidate 수신
          if (data.targetPeerId !== clientIdRef.current) return;
          const pc = peerConnectionsRef.current.get(data.clientId);
          if (pc && data.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
          break;
        }

        case "video-leave": {
          // 피어가 나감
          console.log("피어 나감:", data.clientId);
          const pc = peerConnectionsRef.current.get(data.clientId);
          if (pc) {
            pc.close();
            peerConnectionsRef.current.delete(data.clientId);
          }
          setRemoteStreams((prev) => {
            const newMap = new Map(prev);
            newMap.delete(data.clientId);
            return newMap;
          });
          break;
        }
      }
    },
    [localStream, createPeerConnection]
  );

  /**
   * 화상통화 시작
   */
  const startCall = async () => {
    setIsLoading(true);
    try {
      // 미디어 스트림 가져오기
      const stream = await getLocalStream();
      if (!stream) {
        setIsLoading(false);
        return;
      }

      // WebSocket 연결 (HTTPS면 wss://, HTTP면 ws://)
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("화상통화 WebSocket 연결됨");
        setIsConnected(true);
        setIsLoading(false);

        // 참여 알림
        ws.send(
          JSON.stringify({
            type: "video-join",
            clientId: clientIdRef.current,
          })
        );
      };

      ws.onmessage = handleWebSocketMessage;

      ws.onerror = (error) => {
        console.error("WebSocket 오류:", error);
        setIsLoading(false);
      };

      ws.onclose = () => {
        console.log("화상통화 WebSocket 연결 해제");
        setIsConnected(false);
      };
    } catch (error) {
      console.error("화상통화 시작 오류:", error);
      setIsLoading(false);
    }
  };

  /**
   * 화상통화 종료
   */
  const endCall = useCallback(() => {
    // 퇴장 알림
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "video-leave",
          clientId: clientIdRef.current,
        })
      );
    }

    // 모든 피어 연결 종료
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();

    // 로컬 스트림 정리
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);

    // 원격 스트림 정리
    setRemoteStreams(new Map());

    // WebSocket 종료
    wsRef.current?.close();
    wsRef.current = null;

    setIsConnected(false);
    onClose();
  }, [localStream, onClose]);

  /**
   * 카메라 토글
   */
  const toggleCamera = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  };

  /**
   * 마이크 토글
   */
  const toggleMic = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (isConnected) {
        endCall();
      }
    };
  }, [isConnected, endCall]);

  // 창이 닫히면 통화 종료
  useEffect(() => {
    if (!isOpen && isConnected) {
      endCall();
    }
  }, [isOpen, isConnected, endCall]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="bg-gray-900 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
          <h2 className="text-white font-semibold flex items-center gap-2">
            📹 화상통화
            {isConnected && (
              <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">
                연결됨
              </span>
            )}
          </h2>
          <button
            onClick={endCall}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* 비디오 영역 */}
        <div className="p-4 bg-gray-900">
          {!isConnected ? (
            // 통화 시작 전
            <div className="flex flex-col items-center justify-center h-64">
              <span className="text-6xl mb-4">📹</span>
              <p className="text-gray-400 mb-4">
                화상통화를 시작하려면 아래 버튼을 누르세요
              </p>
              <button
                onClick={startCall}
                disabled={isLoading}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "연결 중..." : "통화 시작"}
              </button>
            </div>
          ) : (
            // 통화 중
            <div className="grid grid-cols-2 gap-4">
              {/* 내 화면 */}
              <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                  나 {!isCameraOn && "(카메라 꺼짐)"}
                </div>
              </div>

              {/* 원격 화면들 */}
              {Array.from(remoteStreams.entries()).map(([peerId, stream]) => (
                <RemoteVideo key={peerId} peerId={peerId} stream={stream} />
              ))}

              {/* 대기 중 표시 */}
              {remoteStreams.size === 0 && (
                <div className="bg-gray-800 rounded-lg flex items-center justify-center aspect-video">
                  <div className="text-center text-gray-500">
                    <span className="text-4xl block mb-2">👤</span>
                    <p>다른 참여자를 기다리는 중...</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 컨트롤 버튼 */}
        {isConnected && (
          <div className="flex items-center justify-center gap-4 px-4 py-3 bg-gray-800 border-t border-gray-700">
            <button
              onClick={toggleCamera}
              className={`p-3 rounded-full transition-colors ${
                isCameraOn
                  ? "bg-gray-600 hover:bg-gray-700 text-white"
                  : "bg-red-600 hover:bg-red-700 text-white"
              }`}
              title={isCameraOn ? "카메라 끄기" : "카메라 켜기"}
            >
              {isCameraOn ? "📷" : "🚫"}
            </button>

            <button
              onClick={toggleMic}
              className={`p-3 rounded-full transition-colors ${
                isMicOn
                  ? "bg-gray-600 hover:bg-gray-700 text-white"
                  : "bg-red-600 hover:bg-red-700 text-white"
              }`}
              title={isMicOn ? "마이크 끄기" : "마이크 켜기"}
            >
              {isMicOn ? "🎤" : "🔇"}
            </button>

            <button
              onClick={endCall}
              className="p-3 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors"
              title="통화 종료"
            >
              📞
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 원격 비디오 컴포넌트
 */
function RemoteVideo({
  peerId,
  stream,
}: {
  peerId: string;
  stream: MediaStream;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
        참여자 {peerId.slice(0, 4)}
      </div>
    </div>
  );
}
