import { createRoot } from 'react-dom/client';
import '@cx/ui/styles.css';
import { ConfigStore, FetchTransport, LocalStorageAdapter, SyncClient } from '@cx/core';
import { SettingsApp } from '@cx/ui';

const transport = new FetchTransport();
const configStore = new ConfigStore(new LocalStorageAdapter());
const syncClient = new SyncClient(transport);

createRoot(document.getElementById('root')!).render(
  <SettingsApp configStore={configStore} syncClient={syncClient} transport={transport} />,
);
