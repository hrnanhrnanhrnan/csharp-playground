using System.Text;
using Microsoft.AspNetCore.SignalR;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Scripting;
using Newtonsoft.Json;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy
            .AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddOutputCache();
builder.Services.AddScoped<IAnalyzer, Analyzer>();
builder.Services.AddScoped<ITreeWalker, TreeWalker>();
builder.Services.AddScoped<IConsoleOutRewriter, ConsoleOutRewriter>();

var app = builder.Build();

app.UseCors();
app.UseOutputCache();

app.MapHub<AnalyzerHub>("/hub");

app.MapGet("/alive", () =>
{
    return "Im Alive!";
})
.CacheOutput();

app.Run();

// -- Types --
record AnalyzedDataItem(string Line, object Value);

record SyntaxInfo(string VariableName, int LineIndex);

interface IAnalyzer
{
    Task<List<AnalyzedDataItem>> Analyze(string code);
}

interface ITreeWalker
{
    void Visit(SyntaxNode? node);
    List<SyntaxInfo> Results { get; }
    void SetSemanticModel(SemanticModel semanticModel);
}

interface IConsoleOutRewriter
{
    SyntaxNode? Visit(SyntaxNode? node);
}

class Analyzer(
    ITreeWalker treeWalker,
    IConsoleOutRewriter consoleOutRewriter)
    : IAnalyzer
{
    private readonly ScriptOptions ScriptOptions = ScriptOptions.Default
        .WithReferences(
            Statics.ScriptOtionReferences
        )
        .WithImports(
            Statics.ScriptOptionImports
        );

    public async Task<List<AnalyzedDataItem>> Analyze(string code)
    {
        List<AnalyzedDataItem> analyzedData = [];

        var syntaxTree = CSharpSyntaxTree.ParseText(code);
        var root = syntaxTree.GetCompilationUnitRoot();

        var lines = code.ReplaceLineEndings().Split('\n');
        var runCodeTask = RunModifiedCodeAsync(root, lines);

        var compilation = CSharpCompilation.Create("Analysis")
            .AddReferences(
                ScriptOptions.MetadataReferences
            )
            .AddSyntaxTrees(syntaxTree);

        var semanticModel = compilation.GetSemanticModel(syntaxTree);
        treeWalker.SetSemanticModel(semanticModel);
        treeWalker.Visit(root);

        var (state, writeLines) = await runCodeTask;

        if (state is null)
        {
            return analyzedData;
        }

        var variables = state.Variables.ToDictionary(x => x.Name, x => (x.Type, x.Value));

        foreach (var syntaxInfo in treeWalker.Results)
        {
            if (!variables.TryGetValue(syntaxInfo.VariableName, out var variable)
                || variable.Type.IsSubclassOf(typeof(Delegate)))
            {
                continue;
            }

            analyzedData.Add(new(lines[syntaxInfo.LineIndex].TrimEnd(), variable.Value));
        }

        analyzedData.AddRange(writeLines);

        return analyzedData;
    }

    private async Task<(ScriptState<object>? state, AnalyzedDataItem[] dataItems)> RunModifiedCodeAsync(
        CompilationUnitSyntax root,
        string[] lines)
    {

        var modifiedRoot = consoleOutRewriter.Visit(root);
        if (modifiedRoot is null)
        {
            return (null, []);
        }

        var fullCode = modifiedRoot.ToFullString();
        var modifiedCode = fullCode += Statics.WriteLineAdjuster;

        var originalOut = Console.Out;
        using var consoleCapturer = new ConsoleCapturer();
        Console.SetOut(consoleCapturer);

        ScriptState<object>? scriptState;
        try
        {
            scriptState = await CSharpScript.RunAsync(
                modifiedCode,
                ScriptOptions
            );
        }
        catch
        {
            return (null, []);
        }

        Console.SetOut(originalOut);

        var capturedWritelines = consoleCapturer
            .Lines
            .Select(x => new AnalyzedDataItem(lines[Statics.GetWriteLineLineIndex(x)].TrimEnd(), Statics.GetWriteLineValue(x)))
            .ToArray();

        return (scriptState!, capturedWritelines ?? []);
    }
}

static class Statics
{
    public static readonly string[] WriteLineClassesToCheck = [
        "Console",
        "System.Console",
        "Console.Error",
        "System.Console.Error",
        "Debug",
        "System.Diagnostics.Debug"
    ];

    public static readonly string[] WriteLineMethodsToCheck = [
        "WriteLine",
        "Write"
    ];

    public static readonly string[] ScriptOptionImports = [
        "System",
        "System.Collections.Generic",
        "System.Collections",
        "System.Linq",
        "System.Threading.Tasks",
        "System.IO",
        "System.Console",
        "System.Linq",
        "System.Net",
        "System.Threading",
        "System.Threading.Tasks"
    ];

    public static readonly PortableExecutableReference[] ScriptOtionReferences = [
        MetadataReference.CreateFromFile(typeof(object).Assembly.Location),
        MetadataReference.CreateFromFile(typeof(Console).Assembly.Location),
        MetadataReference.CreateFromFile(typeof(Task).Assembly.Location),
        MetadataReference.CreateFromFile(typeof(Enumerable).Assembly.Location),
        MetadataReference.CreateFromFile(typeof(System.Runtime.CompilerServices.DynamicAttribute).Assembly.Location),
        MetadataReference.CreateFromFile(typeof(ValueTuple<>).Assembly.Location),
        MetadataReference.CreateFromFile(typeof(Console).Assembly.Location)
    ];

    public const string WriteLineAdjuster = @"

public static class WriteLineAdjuster81927381273916428631286418926491624123123
{
    public static void AdjustWriteLine(int lineNumber, object value)
    {
        Console.WriteLine($""{lineNumber}:{value}"");
    }
}
";

    public static int GetNodeLineIndex(SyntaxNode node)
        => node.GetLocation().GetLineSpan().StartLinePosition.Line;

    public static string GetWriteLineValue(string? row)
    {
        var span = row.AsSpan();
        var colonIndex = span.IndexOf(':');

        return colonIndex >= 0
            ? span[(colonIndex + 1)..].ToString()
            : "";
    }

    public static int GetWriteLineLineIndex(string? row)
    {
        var span = row.AsSpan();
        var index = span.IndexOf(':');

        var nunmAsChar = span[..index];
        int num = int.Parse(nunmAsChar);

        return num;
    }
}

class TreeWalker() : CSharpSyntaxWalker, ITreeWalker
{
    private SemanticModel? _semanticModel;
    public List<SyntaxInfo> Results { get; } = [];

    public void SetSemanticModel(SemanticModel semanticModel)
        => _semanticModel = semanticModel;

    public override void VisitLocalDeclarationStatement(LocalDeclarationStatementSyntax node)
    {
        var lineIndex = Statics.GetNodeLineIndex(node);

        foreach (var variable in node.Declaration.Variables)
        {
            if (_semanticModel.GetDeclaredSymbol(variable) is not ILocalSymbol localSymbol)
            {
                continue;
            }

            Results.Add(new(localSymbol.Name, lineIndex));
        }

        base.VisitLocalDeclarationStatement(node);
    }

    public override void VisitAssignmentExpression(AssignmentExpressionSyntax node)
    {
        if (_semanticModel.GetSymbolInfo(node.Left).Symbol is ILocalSymbol localSymbol)
        {
            Results.Add(new(localSymbol.Name, Statics.GetNodeLineIndex(node)));
        }

        base.VisitAssignmentExpression(node);
    }

    public override void VisitPrefixUnaryExpression(PrefixUnaryExpressionSyntax node)
    {
        if (node.Operand is ExpressionSyntax operand &&
            _semanticModel.GetSymbolInfo(operand).Symbol is ILocalSymbol operandLocal)
        {
            Results.Add(new(operandLocal.Name, Statics.GetNodeLineIndex(node)));
        }

        base.VisitPrefixUnaryExpression(node);
    }

    public override void VisitPostfixUnaryExpression(PostfixUnaryExpressionSyntax node)
    {
        if (node.Operand is ExpressionSyntax operand &&
            _semanticModel.GetSymbolInfo(operand).Symbol is ILocalSymbol operandLocal)
        {
            Results.Add(new(operandLocal.Name, Statics.GetNodeLineIndex(node)));
        }

        base.VisitPostfixUnaryExpression(node);
    }
}

class AnalyzerHub(IAnalyzer analyzer) : Hub
{
    public async Task AnalyzeCode(string code)
    {
        if (code is null)
        {
            return;
        }

        var result = await analyzer.Analyze(code);
        await Clients.Caller.SendAsync("AnalyzedData", JsonConvert.SerializeObject(result));
    }
}

class ConsoleOutRewriter : CSharpSyntaxRewriter, IConsoleOutRewriter
{
    public override SyntaxNode VisitInvocationExpression(InvocationExpressionSyntax node)
    {
        // Kontrollera om uttrycket är av typen MemberAccessExpressionSyntax
        if (node.Expression is MemberAccessExpressionSyntax memberAccess)
        {
            var methodName = memberAccess.Name.Identifier.Text;
            var className = GetFullName(memberAccess.Expression);

            // Kontrollera om det är WriteLine-metoden vi vill ersätta
            if (Statics.WriteLineClassesToCheck.Contains(className)
                && Statics.WriteLineMethodsToCheck.Contains(methodName))
            {
                var lineNumber = Statics.GetNodeLineIndex(node);
                var arguments = node.ArgumentList.Arguments;

                // Hantera fallet där det inte finns några argument
                var argumentList = arguments.Count > 0 ? arguments : SyntaxFactory.SeparatedList<ArgumentSyntax>(
                    new SyntaxNodeOrToken[]
                    {
                    SyntaxFactory.Argument(SyntaxFactory.LiteralExpression(
                        SyntaxKind.StringLiteralExpression,
                        SyntaxFactory.Literal(string.Empty)))
                    });

                var modifiedArguments = SyntaxFactory.ArgumentList(
                    SyntaxFactory.SeparatedList<ArgumentSyntax>(
                        new SyntaxNodeOrToken[]
                        {
                        SyntaxFactory.Argument(SyntaxFactory.LiteralExpression(
                            SyntaxKind.NumericLiteralExpression,
                            SyntaxFactory.Literal(lineNumber))),
                        SyntaxFactory.Token(SyntaxKind.CommaToken),
                        argumentList.First()
                        }
                    ));

                var modifiedInvocation = node.WithExpression(
                    SyntaxFactory.MemberAccessExpression(
                        SyntaxKind.SimpleMemberAccessExpression,
                        SyntaxFactory.IdentifierName("WriteLineAdjuster81927381273916428631286418926491624123123"),
                        SyntaxFactory.IdentifierName("AdjustWriteLine")))
                    .WithArgumentList(modifiedArguments);

                return modifiedInvocation;
            }
        }

        return base.VisitInvocationExpression(node);
    }

    private static string GetFullName(ExpressionSyntax expressionSyntax)
        => expressionSyntax switch
        {
            IdentifierNameSyntax identifier
                => identifier.Identifier.Text,
            QualifiedNameSyntax qualified
                => GetFullName(qualified.Left) + "." + qualified.Right.Identifier.Text,
            MemberAccessExpressionSyntax memberAccess
                => GetFullName(memberAccess.Expression) + "." + memberAccess.Name.Identifier.Text,
            AliasQualifiedNameSyntax aliasQualifiedName
                => aliasQualifiedName.Alias.Identifier.Text + "::" + GetFullName(aliasQualifiedName.Name),
            _ => expressionSyntax.ToString()
        };
}

class ConsoleCapturer : TextWriter
{
    private readonly List<string?> _lines = [];

    public override Encoding Encoding => Encoding.UTF8;

    public override void WriteLine(string? value)
    {
        _lines.Add(value);
    }

    public IReadOnlyList<string?> Lines => _lines;
}