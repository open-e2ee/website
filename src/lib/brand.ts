import tokens from '@open-e2ee/design/tokens';

/*
 * The site reads mark geometry from the published token file rather than
 * restating any path. The relay glyph in every diagram is the organization
 * symbol itself, so a logo that drifted from the diagrams would be a defect
 * the build should catch, not a discrepancy a reviewer has to notice.
 */
export const geometry = tokens.geometry;

export type MarkVariant = 'full' | 'optical';

/** Variant selection by size is a rule, not a judgement call. */
export function variantForSize(size: number): MarkVariant {
  if (size < geometry.minimumSize) {
    throw new RangeError(
      `The OpenE2EE mark is not reproduced below ${geometry.minimumSize} px.`,
    );
  }
  return size <= geometry.smallMaximumSize ? 'optical' : 'full';
}

export function pathsForVariant(variant: MarkVariant): string[] {
  const source = geometry[variant];
  return [source.carrierLeftPath, source.carrierRightPath, source.payloadPath];
}
