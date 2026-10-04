// SPDX-License-Identifier: Elastic-2.0

import { fetch as expoFetch } from 'expo/fetch';

// The SDK bounds responses while reading their streams. React Native's legacy
// global fetch has no response.body; Expo supplies streams on Android/iOS and
// uses the browser fetch on web. Keep injected test transports supported.
export const httpFetch = expoFetch as typeof fetch;
