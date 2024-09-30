using System.Text;
using Microsoft.AspNetCore.SignalR;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Scripting;
using Newtonsoft.Json;

// Setup minimal api and singalR
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

var app = builder.Build();

app.UseCors();
app.UseOutputCache();

app.MapHub<AnalyzerHub>("/hub");

app.MapGet("/alive", () =>
{
    return "Im Alive!";
})
.CacheOutput();

var signalR = app.Services.GetRequiredService<IHubContext<AnalyzerHub>>();

app.Run();

record AnalyzedDataItem(string Line, object Value);

interface IAnalyzer
{
    Task<List<AnalyzedDataItem>> Analyze(string code);
}

interface ITreeWalker
{
    void Visit(SyntaxNode? node);
    List<SyntaxInfo> Results { get; }
}

class Analyzer() : IAnalyzer
{
    // private const int retryCount = 20;
    private readonly ScriptOptions ScriptOptions = ScriptOptions.Default
        .WithReferences(
            MetadataReference.CreateFromFile(typeof(object).Assembly.Location),
            MetadataReference.CreateFromFile(typeof(Console).Assembly.Location),
            MetadataReference.CreateFromFile(typeof(Task).Assembly.Location),
            MetadataReference.CreateFromFile(typeof(Enumerable).Assembly.Location),
            MetadataReference.CreateFromFile(typeof(System.Runtime.CompilerServices.DynamicAttribute).Assembly.Location),
            MetadataReference.CreateFromFile(typeof(ValueTuple<>).Assembly.Location),
            MetadataReference.CreateFromFile(typeof(Console).Assembly.Location)
        )
        .WithImports(
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
        );

    public async Task<List<AnalyzedDataItem>> Analyze(string code)
    {
        List<AnalyzedDataItem> analyzedData = [];

        var syntaxTree = CSharpSyntaxTree.ParseText(code);
        var root = syntaxTree.GetCompilationUnitRoot();

        var compilation = CSharpCompilation.Create("Analysis")
            .AddReferences(
                ScriptOptions.MetadataReferences
            )
            .AddSyntaxTrees(syntaxTree);

        var semanticModel = compilation.GetSemanticModel(syntaxTree);

        var walker = new TreeWalker(semanticModel);
        walker.Visit(root);

        // Modifiera syntaxträdet
        var rewriter = new WriteLineRewriter();
        var newRoot = rewriter.Visit(root);

        var fullCode = newRoot.ToFullString();
        var newCode = fullCode += Statics.WriteLineAdjusterMethod;

        // Omdirigera Console.Out
        var originalOut = Console.Out;
        var captureWriter = new CaptureTextWriter();
        Console.SetOut(captureWriter);

        ScriptState<object>? scriptState = null;

        var (error, result) = await Statics.TryCatch(async () =>
            await CSharpScript.RunAsync(
                newCode,
                ScriptOptions
            )
        );

        if (error is not null)
        {
            System.Console.WriteLine(error.Message);
            return analyzedData;
        }

        scriptState = result;

        var variables = scriptState!.Variables.ToDictionary(x => x.Name, x => x.Value);
        var lines = code!.Split('\n');

        foreach (var syntaxInfo in walker.Results)
        {
            if (!variables.TryGetValue(syntaxInfo.VariableName, out var value))
            {
                continue;
            }

            analyzedData.Add(new(lines[syntaxInfo.LineIndex], value));
        }

        // Återställ Console.Out
        Console.SetOut(originalOut);

        // Visa utdatan
        var writeLines = captureWriter
            .Lines.
            Select(x => new AnalyzedDataItem(lines[Statics.GetWriteLineLineIndex(x)], Statics.GetWriteLineValue(x)));

        analyzedData.AddRange(writeLines);

        return analyzedData;
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

    public const string WriteLineAdjusterMethod = @"

public static class InstrumentationHelper
{
    public static void InstrumentedWriteLine(int lineNumber, object value)
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

    public static (Exception? exception, TResult? result) TryCatch<TResult>(Func<TResult> func)
    {
        try
        {
            var result = func();
            return (null, result);
        }
        catch (System.Exception ex)
        {
            return (ex, default);
        }
    }
    public static async Task<(Exception? exception, TResult? result)> TryCatch<TResult>(Func<Task<TResult>> func)
    {
        try
        {
            var result = await func();
            return (null, result);
        }
        catch (System.Exception ex)
        {
            return (ex, default);
        }
    }
}

class TreeWalker(SemanticModel semanticModel) : CSharpSyntaxWalker, ITreeWalker
{
    public List<SyntaxInfo> Results { get; } = [];

    public override void VisitLocalDeclarationStatement(LocalDeclarationStatementSyntax node)
    {
        var lineIndex = Statics.GetNodeLineIndex(node);

        foreach (var variable in node.Declaration.Variables)
        {
            if (semanticModel.GetDeclaredSymbol(variable) is not ILocalSymbol localSymbol)
            {
                continue;
            }

            Results.Add(new(localSymbol.Name, lineIndex));
        }

        base.VisitLocalDeclarationStatement(node);
    }

    public override void VisitAssignmentExpression(AssignmentExpressionSyntax node)
    {
        if (semanticModel.GetSymbolInfo(node.Left).Symbol is ILocalSymbol localSymbol)
        {
            Results.Add(new(localSymbol.Name, Statics.GetNodeLineIndex(node)));
        }

        base.VisitAssignmentExpression(node);
    }

    public override void VisitPrefixUnaryExpression(PrefixUnaryExpressionSyntax node)
    {
        if (node.Operand is ExpressionSyntax operand &&
            semanticModel.GetSymbolInfo(operand).Symbol is ILocalSymbol operandLocal)
        {
            Results.Add(new(operandLocal.Name, Statics.GetNodeLineIndex(node)));
        }

        base.VisitPrefixUnaryExpression(node);
    }

    public override void VisitPostfixUnaryExpression(PostfixUnaryExpressionSyntax node)
    {
        if (node.Operand is ExpressionSyntax operand &&
            semanticModel.GetSymbolInfo(operand).Symbol is ILocalSymbol operandLocal)
        {
            Results.Add(new(operandLocal.Name, Statics.GetNodeLineIndex(node)));
        }

        base.VisitPostfixUnaryExpression(node);
    }

    public override void VisitForStatement(ForStatementSyntax node)
    {
        var lineIndex = Statics.GetNodeLineIndex(node);

        foreach (var variable in node.Declaration?.Variables ?? [])
        {
            if (semanticModel.GetDeclaredSymbol(variable) is not ILocalSymbol localSymbol)
            {
                continue;
            }

            Results.Add(new(localSymbol.Name, lineIndex));
        }

        base.VisitForStatement(node);
    }



}

record SyntaxInfo(string VariableName, int LineIndex);

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

class WriteLineRewriter : CSharpSyntaxRewriter
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

                var newArguments = SyntaxFactory.ArgumentList(
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

                var newInvocation = node.WithExpression(
                    SyntaxFactory.MemberAccessExpression(
                        SyntaxKind.SimpleMemberAccessExpression,
                        SyntaxFactory.IdentifierName("InstrumentationHelper"),
                        SyntaxFactory.IdentifierName("InstrumentedWriteLine")))
                    .WithArgumentList(newArguments);

                return newInvocation;
            }
        }

        return base.VisitInvocationExpression(node);
    }


    private static string GetFullName(ExpressionSyntax expr)
    {
        if (expr is IdentifierNameSyntax identifier)
        {
            return identifier.Identifier.Text;
        }
        else if (expr is QualifiedNameSyntax qualifiedName)
        {
            return GetFullName(qualifiedName.Left) + "." + qualifiedName.Right.Identifier.Text;
        }
        else if (expr is MemberAccessExpressionSyntax memberAccess)
        {
            return GetFullName(memberAccess.Expression) + "." + memberAccess.Name.Identifier.Text;
        }
        else if (expr is AliasQualifiedNameSyntax aliasQualifiedName)
        {
            return aliasQualifiedName.Alias.Identifier.Text + "::" + GetFullName(aliasQualifiedName.Name);
        }
        else
        {
            return expr.ToString();
        }
    }

}

// Klassen för att fånga upp konsolutskrifter
class CaptureTextWriter : TextWriter
{
    private readonly List<string?> _lines = [];

    public override Encoding Encoding => Encoding.UTF8;

    public override void WriteLine(string? value)
    {
        _lines.Add(value);
    }

    public IReadOnlyList<string?> Lines => _lines;
}