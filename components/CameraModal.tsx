import React, { useRef, useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface CameraModalProps {
  onCapture: (base64: string) => void;
  onClose: () => void;
  isOpen: boolean;
  label?: string;
}

export const CameraModal: React.FC<CameraModalProps> = ({ onCapture, onClose, isOpen, label }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let mounted = true;

    const startCamera = async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }

        let mediaStream;
        try {
            // Try environment (rear) camera first
            mediaStream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } 
            });
        } catch (err) {
            console.warn("Environment camera failed, falling back to default", err);
            // Fallback to any available video source
            mediaStream = await navigator.mediaDevices.getUserMedia({ 
                video: true 
            });
        }

        if (!mounted) {
            mediaStream.getTracks().forEach(track => track.stop());
            return;
        }

        streamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        if (mounted) {
            alert("Erro ao acessar a câmera. Verifique permissões.");
            onClose();
        }
      }
    };

    if (isOpen) {
      startCamera();
    } else {
      // Cleanup if closed
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen, onClose]);

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        onCapture(dataUrl);
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-90 flex flex-col items-center justify-center p-4">
      <div className="relative w-full max-w-md bg-black rounded-lg overflow-hidden flex flex-col h-full max-h-[80vh]">
         <div className="absolute top-4 right-4 z-10">
             <button onClick={onClose} className="p-2 bg-white/20 rounded-full text-white">
                 <X size={24} />
             </button>
         </div>
         
         {label && (
             <div className="absolute top-4 left-4 z-10 bg-black/50 px-3 py-1 rounded text-white text-sm">
                 {label}
             </div>
         )}

         <div className="flex-1 relative flex items-center justify-center bg-gray-900">
            <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted
                className="w-full h-full object-cover"
            />
         </div>

         <div className="p-6 flex justify-center bg-gray-900">
             <button 
                onClick={handleCapture}
                className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all"
             >
                 <div className="w-16 h-16 bg-white rounded-full"></div>
             </button>
         </div>
         <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
};