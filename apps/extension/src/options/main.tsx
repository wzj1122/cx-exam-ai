import { createRoot } from 'react-dom/client';
import '@cx/ui/styles.css';
import { ConfigStore, SyncClient } from '@cx/core';
import { SettingsApp } from '@cx/ui';
import { ChromeStorageAdapter } from '../lib/storage';
import { BackgroundTransport } from '../lib/transport';

const storage = new ChromeStorageAdapter();
const transport = new BackgroundTransport();

createRoot(document.getElementById('root')!).render(
  <SettingsApp
    configStore={new ConfigStore(storage)}
    syncClient={new SyncClient(transport)}
    transport={transport}
  />,
);
