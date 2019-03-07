import BigNumber from 'bignumber.js';

function amountToBigNumber(amount) {
  if (amount instanceof Currency) return amount.toBigNumber();
  const value = BigNumber(amount);
  if (value.lt(0)) throw new Error('amount cannot be negative');
  if (value.isNaN()) throw new Error(`amount "${amount}" is not a number`);
  return value;
}

export class Currency {
  constructor(amount, shift = 0) {
    if (shift === 'wei') shift = -18;
    if (shift === 'ray') shift = -27;
    if (shift === 'rad') shift = -45;
    this._amount = shift
      ? amountToBigNumber(amount).shiftedBy(shift)
      : amountToBigNumber(amount);
    this.symbol = '???';
  }

  isEqual(other) {
    return this._amount.eq(other._amount) && this.symbol == other.symbol;
  }

  toString(decimals = 2) {
    return `${this._amount.toFixed(decimals)} ${this.symbol}`;
  }

  toBigNumber() {
    return this._amount;
  }

  toNumber() {
    return this._amount.toNumber();
  }

  toFixed(shift = 0) {
    if (shift === 'wei') shift = 18;
    if (shift === 'ray') shift = 27;
    if (shift === 'rad') shift = 45;

    // always round down so that we never attempt to spend more than we have
    return this._amount
      .shiftedBy(shift)
      .integerValue(BigNumber.ROUND_DOWN)
      .toFixed();
  }

  isSameType(other) {
    return this.symbol === other.symbol;
  }
}

const mathFunctions = [
  ['plus'],
  ['minus'],
  ['times', 'multipliedBy'],
  ['div', 'dividedBy'],
  ['shiftedBy']
];

const booleanFunctions = [
  ['isLessThan', 'lt'],
  ['isLessThanOrEqualTo', 'lte'],
  ['isGreaterThan', 'gt'],
  ['isGreaterThanOrEqualTo', 'gte'],
  ['eq']
];

function assertValidOperation(method, left, right) {
  const message = `Invalid operation: ${left.symbol} ${method} ${right.symbol}`;

  if (!(right instanceof Currency) || left.isSameType(right)) return;

  if (right instanceof CurrencyRatio) {
    // only supporting Currency as a left operand for now, though we could
    // extend this to support ratio-ratio math if needed
    switch (method) {
      case 'times':
        if (left.isSameType(right.denominator)) return;
        break;
      case 'div':
        if (left.isSameType(right.numerator)) return;
        break;
    }
  } else {
    switch (method) {
      // division between two different units results in a ratio, e.g. USD/DAI
      case 'div':
      return;
    }
  }

  throw new Error(message);
}

function result(method, left, right, value) {
  if (right instanceof CurrencyRatio) {
    switch (method) {
      case 'times':
        return new right.numerator(value);
      case 'div':
        return new right.denominator(value);
    }
  }

  if (!(right instanceof Currency) || left.isSameType(right)) {
    return new left.constructor(value);
  }

  return new CurrencyRatio(value, left.constructor, right.constructor);
}

function bigNumberFnWrapper(method, isBoolean) {
  return function(other) {
    assertValidOperation(method, this, other);

    const otherBigNumber =
      other instanceof Currency ? other.toBigNumber() : other;

    const value = this.toBigNumber()[method](otherBigNumber);
    return isBoolean ? value : result(method, this, other, value);
  };
}

Object.assign(
  Currency.prototype,
  mathFunctions.reduce((output, [method, ...aliases]) => {
    output[method] = bigNumberFnWrapper(method);
    for (let alias of aliases) {
      output[alias] = output[method];
    }
    return output;
  }, {}),
  booleanFunctions.reduce((output, [method, ...aliases]) => {
    output[method] = bigNumberFnWrapper(method, true);
    for (let alias of aliases) {
      output[alias] = output[method];
    }
    return output;
  }, {})
);

const makeCreatorFnWithShift = (creatorFn, symbol, shift) => {
  const fn = amount => creatorFn(amount, shift);
  // these two properties are used by getCurrency
  fn.symbol = symbol;
  fn.shift = shift;
  return fn;
};

export function createCurrency(symbol) {
  // This provides short syntax, e.g. ETH(6). We need a wrapper function because
  // you can't call an ES6 class consructor without `new`
  const creatorFn = (amount, shift) => new CurrencyX(amount, shift);

  class CurrencyX extends Currency {
    constructor(amount, shift) {
      super(amount, shift);
      this.symbol = symbol;

      // this.type can be used an alternative to `this.constructor` when you
      // want to use the short syntax, e.g.:
      //
      //   var foo = ETH(1);
      //   var bar = foo.type(2);
      //   assert(foo.plus(bar).eq(ETH(3)));
      //
      this.type = creatorFn;
    }
  }

  // this changes the name of the class in stack traces
  Object.defineProperty(CurrencyX, 'name', { value: symbol });
  Object.defineProperty(CurrencyX, 'symbol', { value: symbol });

  Object.assign(creatorFn, {
    wei: makeCreatorFnWithShift(creatorFn, symbol, 'wei'),
    ray: makeCreatorFnWithShift(creatorFn, symbol, 'ray'),
    rad: makeCreatorFnWithShift(creatorFn, symbol, 'rad'),
    symbol,
    isInstance: obj => obj instanceof CurrencyX
  });

  Object.assign(CurrencyX, { wei: creatorFn.wei, ray: creatorFn.ray });
  return creatorFn;
}

// FIXME: this is not exactly analogous to Currency above, because all the
// different pairs are instances of the same class rather than subclasses in
// their own right. but for now it works fine, because it's the wrapper
// functions that are used externally anyway. so if we want to be consistent, we
// could either create subclasses for each ratio, or refactor Currency so it
// also just stores its symbol in the instance rather than the subclass.

class CurrencyRatio extends Currency {
  constructor(amount, numerator, denominator, shift) {
    super(amount, shift);
    this.numerator = numerator;
    this.denominator = denominator;
    this.symbol = `${numerator.symbol}/${denominator.symbol}`;
  }
}

export const createCurrencyRatio = (wrappedNumerator, wrappedDenominator) => {
  const numerator = wrappedNumerator(0).constructor;
  const denominator = wrappedDenominator(0).constructor;

  const creatorFn = (amount, shift) =>
    new CurrencyRatio(amount, numerator, denominator, shift);

  const symbol = `${numerator.symbol}/${denominator.symbol}`;

  Object.assign(creatorFn, {
    wei: makeCreatorFnWithShift(creatorFn, symbol, 'wei'),
    ray: makeCreatorFnWithShift(creatorFn, symbol, 'ray'),
    rad: makeCreatorFnWithShift(creatorFn, symbol, 'rad'),
    symbol,
    isInstance: obj => obj instanceof CurrencyRatio && obj.symbol === symbol
  });

  return creatorFn;
};

export const createGetCurrency = currencies => (amount, unit) => {
  if (amount instanceof Currency) return amount;
  if (!unit) throw new Error('Amount is not a Currency');
  const key = typeof unit === 'string' ? unit.toUpperCase() : unit.symbol;
  const ctor = currencies[key];
  if (!ctor) {
    throw new Error(`Couldn't find currency for "${key}"`);
  }
  return ctor(amount, unit.shift);
};
