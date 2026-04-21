import azdev from "azure-devops-node-api";
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from "dotenv";

// Absolute path fix: Ensures .env is found regardless of where Cursor starts the process
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export class AzureAuth {
    constructor() {
        this.url = process.env.AZURE_ORG_URL;
        this.token = process.env.AZURE_PERSONAL_ACCESS_TOKEN;
        this.projectRaw = process.env.AZURE_PROJECT;

        const missing = [];
        if (!this.url) missing.push('AZURE_ORG_URL');
        if (!this.token) missing.push('AZURE_PERSONAL_ACCESS_TOKEN');
        if (!this.projectRaw) missing.push('AZURE_PROJECT');

        if (missing.length > 0) {
            throw new Error(`Environment Load Failed. Missing required environment variables: ${missing.join(', ')}`);
        }

        this.project = encodeURIComponent(this.projectRaw); // Encoded for REST URL paths

        this.authHeader = `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`;
        const authHandler = azdev.getPersonalAccessTokenHandler(this.token);
        this.connection = new azdev.WebApi(this.url, authHandler);
    }
    
    async getWitApi() {
        if (!this._witApi) {
            this._witApi = await this.connection.getWorkItemTrackingApi();
        }
        return this._witApi;
    }
}
