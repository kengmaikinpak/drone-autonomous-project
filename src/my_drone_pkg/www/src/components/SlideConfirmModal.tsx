import React, { useState, useRef, useEffect } from 'react';
import { ArrowRight, X } from 'lucide-react';

export interface SlideConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const SlideConfirmModal: React.FC<SlideConfirmModalProps> = ({
  isOpen,
  title,
  description,
  onConfirm,
  onCancel,
}) => {
  const [drag, setDrag] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      setDrag(0);
      isDragging.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const rect = containerRef.current.getBoundingClientRect();
      const maxX = rect.width - 48; // Container width minus button width roughly
      let newDrag = clientX - rect.left - 24;
      if (newDrag < 0) newDrag = 0;
      if (newDrag > maxX) newDrag = maxX;
      setDrag(newDrag);
    };

    const handleUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (containerRef.current) {
        const maxX = containerRef.current.getBoundingClientRect().width - 48;
        if (drag >= maxX * 0.9) {
          onConfirm(); // Reached the end
        } else {
          setDrag(0); // Snap back if not reached
        }
      }
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('touchend', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
  }, [drag, onConfirm]);

  const startDrag = () => {
    isDragging.current = true;
  };

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white border border-slate-200 rounded-2xl p-4 w-[300px] shadow-2xl text-center">
      <button 
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 transition bg-slate-50 hover:bg-slate-100 rounded-full p-1" 
        onClick={onCancel}
      >
        <X className="w-4 h-4" />
      </button>
      
      <h3 className="font-bold text-[13px] text-blue-600 tracking-widest uppercase mb-1">{title}</h3>
      <p className="text-[10px] text-slate-500 mb-5 leading-relaxed">{description}</p>
      
      <div 
        ref={containerRef} 
        className="relative w-full h-12 bg-slate-50 rounded-full flex items-center border border-slate-200 overflow-hidden group shadow-inner"
      >
        <div className="absolute inset-0 flex items-center justify-center text-[10px] tracking-widest uppercase font-bold text-slate-400 pointer-events-none select-none transition group-hover:text-blue-500">
          Slide to confirm
        </div>
        
        {/* Progress highlight */}
        <div
          className="absolute left-0 top-0 h-full bg-blue-100/50 rounded-l-full pointer-events-none"
          style={{ width: `${drag + 24}px` }}
        />
        
        {/* Thumb button */}
        <div
          onMouseDown={startDrag}
          onTouchStart={startDrag}
          className="absolute w-10 h-10 left-1 rounded-full bg-blue-600 shadow-md shadow-blue-500/30 flex items-center justify-center text-white cursor-grab active:cursor-grabbing border border-blue-500 z-10 hover:bg-blue-700"
          style={{ 
            transform: `translateX(${drag}px)`, 
            transition: isDragging.current ? 'none' : 'transform 0.3s ease-out' 
          }}
        >
          <ArrowRight className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
};

export default SlideConfirmModal;
