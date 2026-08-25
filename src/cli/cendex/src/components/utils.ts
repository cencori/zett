export const formatNumber = (num: number) => {
	const n = Number(num);
	const sign = n < 0 ? "-" : "";
	const abs = Math.abs(n);

	const format = (value: number, suffix: string) => {
		const rounded = Math.round(value * 10) / 10; // 1 decimal max
		const str = Number.isInteger(rounded)
			? rounded.toString()
			: rounded.toFixed(1);
		return sign + str + suffix;
	};

	if (abs >= 1_000_000_000) return format(abs / 1_000_000_000, "B");
	if (abs >= 1_000_000) return format(abs / 1_000_000, "M");
	if (abs >= 1_000) return format(abs / 1_000, "k");
	return sign + abs.toString();
};
