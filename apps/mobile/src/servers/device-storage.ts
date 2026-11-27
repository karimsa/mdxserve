import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KeyValueStorage } from "./storage";

/** The device's storage (AsyncStorage, which Expo Go ships). Nothing the app keeps in it is secret. */
export const deviceStorage: KeyValueStorage = {
	getItem: (key) => AsyncStorage.getItem(key),
	setItem: (key, value) => AsyncStorage.setItem(key, value),
};
