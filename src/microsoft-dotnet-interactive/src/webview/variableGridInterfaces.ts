// Copyright (c) .NET Foundation and contributors. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

export interface VariableGridRow {
    name: string;
    value: string;
    typeName: string;
    kernelDisplayName: string;
    kernelName: string;
    link: string;
}

export interface VariableInfo {
    sourceKernelName: string;
    valueName: string;
}
