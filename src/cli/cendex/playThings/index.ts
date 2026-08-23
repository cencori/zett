// index.ts

// Fibonacci sequence: returns an array of the first n Fibonacci numbers
export const fibonacci = (n: number): number[] => {
  const seq: number[] = [0, 1];
  if (n <= 0) return [];
  if (n === 1) return [0];
  for (let i = 2; i < n; i++) {
    seq.push(seq[i - 1] + seq[i - 2]);
  }
  return seq.slice(0, n);
};

// Factorial: returns n! (throws for negative numbers)
export const factorial = (n: number): number => {
  if (n < 0) throw new Error('Factorial is not defined for negative numbers');
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
};
