export function speechBeforeDeadline<T>(
	promise: PromiseLike<T>,
	deadline: number,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() =>
				reject(
					new Error(
						"Speech generation timed out. Review the provider before retrying.",
					),
				),
			Math.max(0, deadline - Date.now()),
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
