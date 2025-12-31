import React, { useMemo } from 'react';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  children: React.ReactNode;
}

export const WobblyButton: React.FC<Props> = ({ variant = 'primary', className, children, ...props }) => {
  // Generate random border radius for sketched look
  const borderRadius = useMemo(() => {
    const r = () => Math.floor(Math.random() * 10 + 245); // 245-255
    const s = () => Math.floor(Math.random() * 10 + 10);  // 10-20
    return `${r()}px ${s()}px ${r()}px ${s()}px / ${s()}px ${r()}px ${s()}px ${r()}px`;
  }, []);

  const baseStyles = "relative px-6 py-3 font-hand text-xl font-bold transition-transform active:scale-95 disabled:opacity-50 disabled:active:scale-100 border-2";
  
  let variantStyles = "";
  switch (variant) {
    case 'primary':
      variantStyles = "bg-interaction text-white border-transparent shadow-md hover:-translate-y-0.5";
      break;
    case 'secondary':
      variantStyles = "bg-accent text-ink border-ink border-opacity-10 shadow-sm hover:-translate-y-0.5";
      break;
    case 'danger':
      variantStyles = "bg-danger text-white border-transparent shadow-md hover:-translate-y-0.5";
      break;
    case 'ghost':
      variantStyles = "bg-transparent text-ink border-ink border-dashed hover:bg-black/5";
      break;
  }

  return (
    <button
      style={{ borderRadius }}
      className={`${baseStyles} ${variantStyles} ${className || ''}`}
      {...props}
    >
      {children}
    </button>
  );
};
