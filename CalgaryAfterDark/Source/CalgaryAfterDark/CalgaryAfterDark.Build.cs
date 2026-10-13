using UnrealBuildTool;

public class CalgaryAfterDark : ModuleRules
{
	public CalgaryAfterDark(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput",
			"ProceduralMeshComponent", "PhysicsCore", "Json"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Slate", "SlateCore", "AudioMixer", "ApplicationCore"
		});

		if (Target.bBuildEditor)
		{
			// Only used by the one-time material bootstrap commandlet (CADSetupCommandlet).
			PrivateDependencyModuleNames.AddRange(new string[] { "UnrealEd", "AssetRegistry" });
		}
	}
}
