/**
 * Mock @prisma/client/runtime/library — provides Decimal for unit tests.
 * Wraps native number with the subset of the Decimal.js API used by our domain.
 */

export class Decimal {
  private readonly value: number

  constructor(value: string | number | Decimal) {
    if (value instanceof Decimal) {
      this.value = value.value
    } else {
      this.value = typeof value === 'string' ? parseFloat(value) : value
    }
  }

  plus(other: Decimal | string | number): Decimal {
    const o = other instanceof Decimal ? other.value : parseFloat(String(other))
    return new Decimal(this.value + o)
  }

  minus(other: Decimal | string | number): Decimal {
    const o = other instanceof Decimal ? other.value : parseFloat(String(other))
    return new Decimal(this.value - o)
  }

  mul(other: Decimal | string | number): Decimal {
    const o = other instanceof Decimal ? other.value : parseFloat(String(other))
    return new Decimal(this.value * o)
  }

  div(other: Decimal | string | number): Decimal {
    const o = other instanceof Decimal ? other.value : parseFloat(String(other))
    return new Decimal(this.value / o)
  }

  toDecimalPlaces(dp: number, mode?: number): Decimal {
    const factor = Math.pow(10, dp)
    if (mode === Decimal.ROUND_DOWN) {
      const truncated = this.value < 0
        ? Math.ceil(this.value * factor) / factor
        : Math.floor(this.value * factor) / factor
      return new Decimal(truncated)
    }
    return new Decimal(Math.round(this.value * factor) / factor)
  }

  abs(): Decimal {
    return new Decimal(Math.abs(this.value))
  }

  floor(): Decimal {
    return new Decimal(Math.floor(this.value))
  }

  modulo(other: Decimal | string | number): Decimal {
    const o = other instanceof Decimal ? other.value : parseFloat(String(other))
    return new Decimal(this.value % o)
  }

  dividedBy(other: Decimal | string | number): Decimal {
    return this.div(other)
  }

  static ROUND_DOWN = 1

  toNumber(): number {
    return this.value
  }

  toString(): string {
    return String(this.value)
  }

  toFixed(dp: number): string {
    return this.value.toFixed(dp)
  }

  greaterThan(other: Decimal | string | number): boolean {
    const o = other instanceof Decimal ? other.value : parseFloat(String(other))
    return this.value > o
  }

  gt(other: Decimal | string | number): boolean {
    return this.greaterThan(other)
  }

  gte(other: Decimal | string | number): boolean {
    const o = other instanceof Decimal ? other.value : parseFloat(String(other))
    return this.value >= o
  }

  greaterThanOrEqualTo(other: Decimal | string | number): boolean {
    return this.gte(other)
  }

  lessThan(other: Decimal | string | number): boolean {
    const o = other instanceof Decimal ? other.value : parseFloat(String(other))
    return this.value < o
  }

  lt(other: Decimal | string | number): boolean {
    return this.lessThan(other)
  }

  lte(other: Decimal | string | number): boolean {
    const o = other instanceof Decimal ? other.value : parseFloat(String(other))
    return this.value <= o
  }

  lessThanOrEqualTo(other: Decimal | string | number): boolean {
    return this.lte(other)
  }

  add(other: Decimal | string | number): Decimal {
    return this.plus(other)
  }

  sub(other: Decimal | string | number): Decimal {
    return this.minus(other)
  }

  equals(other: Decimal | string | number): boolean {
    const o = other instanceof Decimal ? other.value : parseFloat(String(other))
    return this.value === o
  }

  eq(other: Decimal | string | number): boolean {
    return this.equals(other)
  }

  isNegative(): boolean {
    return this.value < 0
  }

  isZero(): boolean {
    return this.value === 0
  }

  negated(): Decimal {
    return new Decimal(-this.value)
  }

  static max(left: Decimal | string | number, right: Decimal | string | number): Decimal {
    const leftValue = left instanceof Decimal ? left.value : parseFloat(String(left))
    const rightValue = right instanceof Decimal ? right.value : parseFloat(String(right))
    return new Decimal(Math.max(leftValue, rightValue))
  }
}
