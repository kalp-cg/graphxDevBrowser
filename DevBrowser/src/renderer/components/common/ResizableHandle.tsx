import React from 'react';

interface ResizableHandleProps {
  onResize: (deltaY: number) => void;
}

export const ResizableHandle: React.FC<ResizableHandleProps> = ({ onResize }) => {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      onResize(deltaY);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        height: '5px',
        width: '100%',
        cursor: 'row-resize',
        background: 'var(--border-subtle)',
        position: 'relative',
        zIndex: 20
      }}
      className="transition-smooth hover:bg-cyan-500"
    >
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '32px',
        height: '2px',
        borderRadius: '1px',
        background: 'var(--border-medium)'
      }} />
    </div>
  );
};
