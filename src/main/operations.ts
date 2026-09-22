/** Track already-started work so shutdown can finish writes before the process exits. */
export class PendingOperations {
  private readonly pending = new Set<Promise<unknown>>()

  track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation)
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation)
    )
    return operation
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending])
  }
}
