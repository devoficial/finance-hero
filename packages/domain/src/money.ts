const PAISE_PER_RUPEE = 100n;

export class Money {
  private constructor(readonly paise: bigint) {}

  static fromPaise(paise: bigint): Money {
    return new Money(paise);
  }

  static fromRupees(rupees: number): Money {
    if (!Number.isFinite(rupees)) {
      throw new TypeError("Rupees must be a finite number.");
    }

    return new Money(BigInt(Math.round(rupees * Number(PAISE_PER_RUPEE))));
  }

  static zero(): Money {
    return new Money(0n);
  }

  add(other: Money): Money {
    return new Money(this.paise + other.paise);
  }

  negate(): Money {
    return new Money(-this.paise);
  }

  equals(other: Money): boolean {
    return this.paise === other.paise;
  }
}
