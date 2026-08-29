'use client';
import { motion } from 'framer-motion';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type AnimateIconAnimations,
  type IconComponentProps,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

const animations: AnimateIconAnimations = {
  default: {
    circle: {},

    line1: {
      initial: {
        rotate: 0,
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
      animate: {
        transformOrigin: 'top left',
        rotate: [0, 20, 0],
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
    },

    line2: {
      initial: {
        rotate: 0,
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
      animate: {
        transformOrigin: 'bottom left',
        rotate: 360,
        transition: { ease: 'easeInOut', duration: 0.6 },
      },
    },
  },
};

function IconComponent({ size, ...props }: IconComponentProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <motion.circle cx={12} cy={12} r={10} variants={variants.circle} initial="initial" animate={controls} />
      <motion.line x1={12} y1={12} x2={16} y2={14} variants={variants.line1} initial="initial" animate={controls} />
      <motion.line x1={12} y1={6} x2={12} y2={12} variants={variants.line2} initial="initial" animate={controls} />
    </motion.svg>
  );
}

function Clock(props: IconProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export { animations, Clock, Clock as ClockIcon };
