export { type FinanceHeroDatabase, initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";
export {
  type DatabaseKeyProvider,
  EnvironmentDatabaseKeyProvider,
  MacOSKeychainDatabaseKeyProvider,
} from "./key-provider";
