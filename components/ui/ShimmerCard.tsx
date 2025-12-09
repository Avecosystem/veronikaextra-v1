// components/ui/ShimmerCard.tsx
import React from 'react';

interface ShimmerCardProps {
  className?: string;
}

const ShimmerCard: React.FC<ShimmerCardProps> = ({ className }) => {
  return (
    <div className={`relative overflow-hidden rounded-2xl
                    bg-gradient-to-br from-gray-800/20 to-gray-700/10 dark:from-gray-100/20 dark:to-gray-200/10
                    backdrop-filter backdrop-blur-sm border border-gray-700/50 dark:border-gray-300/50
                    shadow-glass-dark dark:shadow-glass-light
                    animate-fade-in
                    ${className}`}>
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_1.5s_infinite_forwards_ease-in-out]" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xs uppercase tracking-widest text-gray-400 dark:text-gray-500">Generating...</div>
          <div className="mt-2 text-lg font-extrabold text-gray-300 dark:text-gray-600 drop-shadow-sm">VARONIKAextra</div>
        </div>
      </div>
      <div className="w-full h-full bg-gray-700/20 dark:bg-gray-300/20" />
    </div>
  );
};

export default ShimmerCard;

// Add this keyframe to your tailwind.config.js (already done in index.html for this project)
// keyframes: {
//   shimmer: {
//     '0%': { transform: 'translateX(-100%)' },
//     '100%': { transform: 'translateX(100%)' },
//   }
// },
// animation: {
//   shimmer: 'shimmer 1.5s infinite forwards ease-in-out',
// }
