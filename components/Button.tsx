import React from 'react';
import { twMerge } from 'tailwind-merge';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'success' | 'connect' | 'danger' | 'outline';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  isLoading, 
  className = '', 
  disabled, 
  ...props 
}) => {
  // Styles based on the screenshots
  const baseStyles = "px-6 py-3 rounded-xl font-bold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-95 text-sm md:text-base";
  
  const variants = {
    primary: "bg-action hover:bg-action-hover text-white shadow-lg shadow-blue-900/20", // The Blue "Approve/Buy" button
    success: "bg-success hover:bg-success-hover text-white shadow-lg shadow-green-900/20", // The Green "Claim" button
    connect: "bg-brand hover:bg-amber-400 text-black font-extrabold", // The Gold "Connect" button
    danger: "bg-red-600 hover:bg-red-500 text-white",
    outline: "bg-transparent border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white"
  };

  return (
    <button 
      className={twMerge(baseStyles, variants[variant], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="animate-spin h-5 w-5" />}
      {children}
    </button>
  );
};