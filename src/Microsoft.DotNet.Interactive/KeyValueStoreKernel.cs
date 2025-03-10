﻿// Copyright (c) .NET Foundation and contributors. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.DotNet.Interactive.Commands;
using Microsoft.DotNet.Interactive.Events;
using Microsoft.DotNet.Interactive.Formatting;
using Microsoft.DotNet.Interactive.Utility;
using Microsoft.DotNet.Interactive.ValueSharing;
using static Microsoft.DotNet.Interactive.ChooseKeyValueStoreKernelDirective;

namespace Microsoft.DotNet.Interactive;

public class KeyValueStoreKernel :
    Kernel,
    IKernelCommandHandler<RequestValueInfos>,
    IKernelCommandHandler<RequestValue>,
    IKernelCommandHandler<SendValue>,
    IKernelCommandHandler<SubmitCode>
{
    internal const string DefaultKernelName = "value";

    private readonly ConcurrentDictionary<string, FormattedValue> _values = new();
    private ChooseKeyValueStoreKernelDirective _chooseKernelDirective;
    private (bool hadValue, FormattedValue previousValue, string newValue)? _lastOperation;

    public KeyValueStoreKernel(string name = DefaultKernelName) : base(name)
    {
        KernelInfo.DisplayName = "Raw Value Storage";
    }

    Task IKernelCommandHandler<RequestValueInfos>.HandleAsync(RequestValueInfos command, KernelInvocationContext context)
    {
        var valueInfos = _values.Select(e => new KernelValueInfo(e.Key, e.Value, typeName: e.Value.MimeType)).ToArray();
        context.Publish(new ValueInfosProduced(valueInfos, command));
        return Task.CompletedTask;
    }

    Task IKernelCommandHandler<RequestValue>.HandleAsync(RequestValue command, KernelInvocationContext context)
    {
        if (_values.TryGetValue(command.Name, out var value))
        {
            context.Publish(new ValueProduced(
                value.Value,
                command.Name,
                value,
                command));
        }
        else
        {
            context.Fail(command, message: $"Value '{command.Name}' not found in kernel {Name}");
        }

        return Task.CompletedTask;
    }

    Task IKernelCommandHandler<SendValue>.HandleAsync(SendValue command, KernelInvocationContext context)
    {
        _values[command.Name] = command.FormattedValue;
        return Task.CompletedTask;
    }

    // todo: change to ChooseKeyValueStoreKernelDirective after removing NetStandardc2.0 dependency
    public override ChooseKernelDirective ChooseKernelDirective =>
        _chooseKernelDirective ??= new(this);

    public IReadOnlyDictionary<string, FormattedValue> Values => _values;

    Task IKernelCommandHandler<SubmitCode>.HandleAsync(
        SubmitCode command,
        KernelInvocationContext context)
    {
        var parseResult = command.KernelChooserParseResult;

        var value = command.LanguageNode.Text.Trim();

        var options = ValueDirectiveOptions.Create(parseResult, _chooseKernelDirective);

        StoreValue(command, context, options, value);

        return Task.CompletedTask;
    }

    internal override bool AcceptsUnknownDirectives => true;

    internal async Task TryStoreValueFromOptionsAsync(
        KernelInvocationContext context,
        ValueDirectiveOptions options)
    {
        string newValue = null;
        var loadedFromOptions = false;

        if (options.FromFile is { } file)
        {
            newValue = await IOExtensions.ReadAllTextAsync(file.FullName);
            loadedFromOptions = true;
        }
        else if (options.FromUrl is { } uri)
        {
            var client = new HttpClient();
            var response = await client.GetAsync(uri, context.CancellationToken);
            newValue = await response.Content.ReadAsStringAsync();
            loadedFromOptions = true;
        }
        else if (options.FromValue is { } value)
        {
            newValue = value;
            loadedFromOptions = true;
        }

        if (loadedFromOptions)
        {
            var hadValue = _values.TryGetValue(options.Name, out var previousValue);

            _lastOperation = (hadValue, previousValue, newValue);

            StoreValue(newValue, options, context);
        }
        else
        {
            _lastOperation = null;
        }
    }

    private void StoreValue(
        KernelCommand command, 
        KernelInvocationContext context, 
        ValueDirectiveOptions options,
        string value = null)
    {
        if (options.FromFile is { })
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                UndoSetValue();
                context.Fail(command,
                    message: "The --from-file option cannot be used in combination with a content submission.");
            }
                
        }
        else if (options.FromUrl is { })
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                UndoSetValue();
                context.Fail(command,
                    message: "The --from-url option cannot be used in combination with a content submission.");
            }
        }
        else
        {
            StoreValue(value, options, context);
        }

        _lastOperation = default;

        void UndoSetValue()
        {
            if (_lastOperation is {})
            {
                if (_lastOperation?.hadValue == true)
                {
                    // restore value
                    _values[options.Name] = _lastOperation?.previousValue;
                }
                else
                {
                    // remove entry
                    _values.TryRemove(options.Name, out _);
                }

                _lastOperation = null;
            }
        }
    }

    private void StoreValue(
        string value,
        ValueDirectiveOptions options,
        KernelInvocationContext context)
    {
        _values[options.Name] = new FormattedValue(options.MimeType ?? PlainTextFormatter.MimeType, value);

        if (options.MimeType is { } mimeType)
        {
            context.DisplayAs(value, mimeType);
        }
    }
}