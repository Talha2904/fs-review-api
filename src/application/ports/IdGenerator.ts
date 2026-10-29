/** Makes ids for new records. The application creates every id; the database never does (portability rule). */
export interface IdGenerator {
  /** A UUID v4 string. */
  next(): string;
}
