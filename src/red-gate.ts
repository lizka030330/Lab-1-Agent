// Навмисне падіння (Лаб. 3, крок 01): поля b у типі немає — ланцюг має червоніти на брамі types.
export const brokenOnPurpose: number = ({ a: 1 } as { a: number }).b;
