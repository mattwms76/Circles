import React from 'react';
import Svg, { Path } from 'react-native-svg';
import paths from '../icon-paths.json';
import { colors } from '../theme';

export type IconName = keyof typeof paths;
export function Icon({
  name,
  color = colors.ink,
  size = 24,
  filled = false,
}: {
  name: IconName;
  color?: string;
  size?: number;
  filled?: boolean;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={name === 'more' ? 3.5 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      accessible={false}
    >
      {paths[name].map((d, i) => (
        <Path key={i} d={d} />
      ))}
    </Svg>
  );
}
