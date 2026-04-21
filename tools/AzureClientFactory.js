import { AzureClient } from '../AzureClient.js';

let _azure = null;

export function getAzureClient() {
    if (!_azure) _azure = new AzureClient();
    return _azure;
}

export function resetAzureClient() {
    _azure = null;
}
