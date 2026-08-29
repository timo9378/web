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
    path: {
      initial: {
        y: 0,
      },
      animate: {
        y: [0, 2, -2, 0],
        transition: {
          duration: 0.6,
          ease: 'easeInOut',
        },
      },
    },

    circle: {
      initial: {
        y: 0,
      },
      animate: {
        y: [0, 4, -2, 0],
        transition: {
          duration: 0.6,
          ease: 'easeInOut',
        },
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
      <motion.path
        d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"
        variants={variants.path}
        initial="initial"
        animate={controls}
      />
      <motion.circle cx={12} cy={7} r={4} variants={variants.circle} initial="initial" animate={controls} />
    </motion.svg>
  );
}

function User(props: IconProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export { animations, User, User as UserIcon };
