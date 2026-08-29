'use client';
import * as React from 'react';
import { motion, isMotionComponent } from 'framer-motion';
import { cn } from '@/lib/utils';

type AnyProps = Record<string, unknown>;

function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        ref.current = node;
      }
    }
  };
}

function mergeProps(childProps: AnyProps, slotProps: AnyProps): AnyProps {
  const merged: AnyProps = { ...childProps, ...slotProps };

  if (childProps.className || slotProps.className) {
    merged.className = cn(childProps.className as string | undefined, slotProps.className as string | undefined);
  }

  if (childProps.style || slotProps.style) {
    merged.style = {
      ...(childProps.style as React.CSSProperties | undefined),
      ...(slotProps.style as React.CSSProperties | undefined),
    };
  }

  return merged;
}

interface SlotProps {
  children: React.ReactElement<AnyProps & { ref?: React.Ref<unknown> }>;
  ref?: React.Ref<unknown>;
  [key: string]: unknown;
}

function Slot({ children, ref, ...props }: SlotProps) {
  const childType = children.type;
  const isAlreadyMotion = typeof childType === 'object' && childType !== null && isMotionComponent(childType);

  // Slot 的本質：用 motion 包裝任意子元素的型別，只有 render 期才知道子元素是什麼，
  // 故無法把 motion.create 提到模組層級——這正是 animate-ui 既有設計。
  // eslint-disable-next-line @eslint-react/static-components -- 多型 Slot 必須在 render 期生成 motion 元件
  const Base = React.useMemo<React.ElementType>(
    () => (isAlreadyMotion ? (childType as React.ElementType) : motion.create(childType as React.ComponentType)),
    [isAlreadyMotion, childType],
  );

  if (!React.isValidElement(children)) return null;

  const { ref: childRef, ...childProps } = children.props;

  const mergedProps = mergeProps(childProps, props);

  // 動態多型元件用 createElement（避免 R3F 全域 JSX augmentation 把 ElementType 的 props 收成 never）
  return React.createElement(Base, { ...mergedProps, ref: mergeRefs(childRef, ref) });
}

export { Slot };
