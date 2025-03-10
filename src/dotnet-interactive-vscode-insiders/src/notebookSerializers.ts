// Copyright (c) .NET Foundation and contributors. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import * as contracts from './vscode-common/dotnet-interactive/contracts';
import * as utilities from './vscode-common/interfaces/utilities';
import * as vscodeLike from './vscode-common/interfaces/vscode-like';
import { languageToCellKind } from './vscode-common/interactiveNotebook';
import * as vscodeUtilities from './vscode-common/vscodeUtilities';
import { NotebookParserServer } from './vscode-common/notebookParserServer';
import { Eol } from './vscode-common/interfaces';
import * as metadataUtilities from './vscode-common/metadataUtilities';
import * as constants from './vscode-common/constants';

function toInteractiveDocumentElement(cell: vscode.NotebookCellData): contracts.InteractiveDocumentElement {
    // just need to match the shape
    const fakeCell: vscodeLike.NotebookCell = {
        kind: 0,
        metadata: cell.metadata ?? {}
    };
    const notebookCellMetadata = metadataUtilities.getNotebookCellMetadataFromNotebookCellElement(fakeCell);
    const outputs = cell.outputs || [];
    return {
        executionOrder: cell.executionSummary?.executionOrder ?? 0,
        kernelName: cell.languageId === 'markdown' ? 'markdown' : notebookCellMetadata.kernelName ?? 'csharp',
        contents: cell.value,
        outputs: outputs.map(vscodeUtilities.vsCodeCellOutputToContractCellOutput)
    };
}

async function deserializeNotebookByType(parserServer: NotebookParserServer, serializationType: contracts.DocumentSerializationType, rawData: Uint8Array): Promise<vscode.NotebookData> {
    const interactiveDocument = await parserServer.parseInteractiveDocument(serializationType, rawData);
    const notebookMetadata = metadataUtilities.getNotebookDocumentMetadataFromInteractiveDocument(interactiveDocument);
    const createForIpynb = serializationType === contracts.DocumentSerializationType.Ipynb;
    const rawNotebookDocumentMetadata = metadataUtilities.getRawNotebookDocumentMetadataFromNotebookDocumentMetadata(notebookMetadata, createForIpynb);
    const notebookData: vscode.NotebookData = {
        cells: interactiveDocument.elements.map(element => toVsCodeNotebookCellData(element)),
        metadata: rawNotebookDocumentMetadata
    };
    return notebookData;
}

async function serializeNotebookByType(parserServer: NotebookParserServer, serializationType: contracts.DocumentSerializationType, eol: Eol, data: vscode.NotebookData): Promise<Uint8Array> {
    // just need to match the shape
    const fakeNotebookDocument: vscodeLike.NotebookDocument = {
        uri: {
            fsPath: 'unused',
            scheme: 'unused'
        },
        metadata: data.metadata ?? {}
    };
    const notebookMetadata = metadataUtilities.getNotebookDocumentMetadataFromNotebookDocument(fakeNotebookDocument);
    const rawInteractiveDocumentNotebookMetadata = metadataUtilities.getRawInteractiveDocumentMetadataFromNotebookDocumentMetadata(notebookMetadata);
    const interactiveDocument: contracts.InteractiveDocument = {
        elements: data.cells.map(toInteractiveDocumentElement),
        metadata: rawInteractiveDocumentNotebookMetadata
    };
    const rawData = await parserServer.serializeNotebook(serializationType, eol, interactiveDocument);
    return rawData;
}

export function createAndRegisterNotebookSerializers(context: vscode.ExtensionContext, parserServer: NotebookParserServer): Map<string, vscode.NotebookSerializer> {
    const eol = vscodeUtilities.getEol();
    const createAndRegisterSerializer = (serializationType: contracts.DocumentSerializationType, notebookType: string): vscode.NotebookSerializer => {
        const serializer: vscode.NotebookSerializer = {
            deserializeNotebook(content: Uint8Array, _token: vscode.CancellationToken): Promise<vscode.NotebookData> {
                return deserializeNotebookByType(parserServer, serializationType, content);
            },
            serializeNotebook(data: vscode.NotebookData, _token: vscode.CancellationToken): Promise<Uint8Array> {
                return serializeNotebookByType(parserServer, serializationType, eol, data);
            },
        };
        const notebookSerializer = vscode.workspace.registerNotebookSerializer(notebookType, serializer);
        context.subscriptions.push(notebookSerializer);
        return serializer;
    };

    const serializers = new Map<string, vscode.NotebookSerializer>();
    serializers.set(constants.NotebookViewType, createAndRegisterSerializer(contracts.DocumentSerializationType.Dib, constants.NotebookViewType));
    serializers.set(constants.JupyterViewType, createAndRegisterSerializer(contracts.DocumentSerializationType.Ipynb, constants.JupyterNotebookViewType));
    return serializers;
}

function toVsCodeNotebookCellData(cell: contracts.InteractiveDocumentElement): vscode.NotebookCellData {
    const cellData = new vscode.NotebookCellData(
        <number>languageToCellKind(cell.kernelName),
        cell.contents,
        cell.kernelName === 'markdown' ? 'markdown' : constants.CellLanguageIdentifier);
    const notebookCellMetadata: metadataUtilities.NotebookCellMetadata = {
        kernelName: cell.kernelName
    };
    const rawNotebookCellMetadata = metadataUtilities.getRawNotebookCellMetadataFromNotebookCellMetadata(notebookCellMetadata);
    cellData.metadata = rawNotebookCellMetadata;
    cellData.outputs = cell.outputs.map(outputElementToVsCodeCellOutput);
    return cellData;
}

function outputElementToVsCodeCellOutput(output: contracts.InteractiveDocumentOutputElement): vscode.NotebookCellOutput {
    const outputItems: Array<vscode.NotebookCellOutputItem> = [];
    if (utilities.isDisplayOutput(output)) {
        for (const mimeKey in output.data) {
            outputItems.push(generateVsCodeNotebookCellOutputItem(output.data[mimeKey], mimeKey));
        }
    } else if (utilities.isErrorOutput(output)) {
        outputItems.push(generateVsCodeNotebookCellOutputItem(output.errorValue, vscodeLike.ErrorOutputMimeType));
    } else if (utilities.isTextOutput(output)) {
        outputItems.push(generateVsCodeNotebookCellOutputItem(output.text, 'text/plain'));
    }

    return new vscode.NotebookCellOutput(outputItems);
}

function generateVsCodeNotebookCellOutputItem(value: Uint8Array | string, mime: string): vscode.NotebookCellOutputItem {
    const displayValue = utilities.reshapeOutputValueForVsCode(value, mime);
    return new vscode.NotebookCellOutputItem(displayValue, mime);
}
