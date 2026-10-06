import { Fragment } from 'react';
import styles from './GroupedAddress.module.css';

/** Reading groups for an address: the prefix with the first four characters, then fours. */
export function addressGroups(address: string): string[] {
  return [address.slice(0, 6), ...(address.slice(6).match(/.{1,4}/g) ?? [])];
}

/**
 * An address set in fours, two lines of five, with the first and last groups
 * emphasized because those are the parts people compare. Groups are separated
 * by `<wbr>` and spacing only, so selecting or copying by hand still yields
 * the exact address.
 */
export function GroupedAddress({ address, align = 'start', className = '' }: { address: string; align?: 'start' | 'center'; className?: string }) {
  const groups = addressGroups(address);
  return (
    <span className={`${styles.address} font-mono ${className}`} data-align={align} translate="no">
      {groups.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          <span data-edge={index === 0 || index === groups.length - 1 || undefined}>{group}</span>
        </Fragment>
      ))}
    </span>
  );
}
